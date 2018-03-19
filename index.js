require('dotenv').config();

const fs = require('fs');
const assert = require('assert');
const _ = require('lodash');
const fetch = require('node-fetch');
const keythereum = require('keythereum');
const ethTx = require('ethereumjs-tx');
const erc20abi = require('human-standard-token-abi');

// using web3.js 0.2x.x for now instead of 1.0 because of https://github.com/ethereum/web3.js/issues/1255

const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8545')); // Geth
//const web3 = new Web3(new Web3.providers.HttpProvider(`https://mainnet.infura.io/${process.env.INFURA_ACCESS_TOKEN}`));

const shapeshiftAPI = 'https://shapeshift.io';
const dataDir = process.env.ETHEREUM_WALLET_DATA_DIR;
const fundsAddress = process.env.FUNDS_ACCOUNT_ADDRESS.toLowerCase();
const fundsAddressKeyObject = keythereum.importFromFile(fundsAddress, dataDir);
const fundsAddressPrivateKey = keythereum.recover(process.env.FUNDS_ACCOUNT_PASSWORD, fundsAddressKeyObject);

const erc20Symbol = 'EOS';

function sleep(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getContractAddress(symbol) {
    const ethTokens = JSON.parse(fs.readFileSync(`${__dirname}/ethTokens.json`, 'utf8'));
    const ethToken = ethTokens.find(token => token.symbol === symbol);
    assert(ethToken.address, 'no contract address in ethTokens.json');
    return ethToken.address;
}

// ------------------------------------------------------------------------
// transfer of
// - contract supplied: ERC20 tokens
// - contract not supplied: Ether
// ------------------------------------------------------------------------

async function transfer({ from, to, amount, privateKey, contract }) {
    const data = contract && contract.transfer.getData(to, amount);
    const transactionCount = Math.max(web3.eth.getTransactionCount(from));
    const gasPrice = web3.eth.gasPrice;
    const gasEstimate = web3.eth.estimateGas({ from, to: contract.address, data });

    const tx = new ethTx({
        nonce: web3.toHex(transactionCount),
        gasPrice: web3.toHex(gasPrice),
        gasLimit: web3.toHex(gasEstimate * 2),
        from,
        to: contract ? contract.address : to,
        data,
        value: web3.toHex(contract ? 0 : amount),
    });

    tx.sign(privateKey);

    const serializedTx = tx.serialize();

    const transactionHash = web3.eth.sendRawTransaction('0x' + serializedTx.toString('hex'));
    console.log(`transaction hash: ${transactionHash}`);

    console.log('waiting for transaction receipt...');
    let transactionReceipt = null;
    while (!transactionReceipt) {
        try {
            transactionReceipt = web3.eth.getTransactionReceipt(transactionHash);
        } catch (err) {
            // Geth throws 'uknown transaction' for pending transactions (Infura doesn't)
            if (err.message !== 'unknown transaction') {
                throw err;
            }
        }
        await sleep(1000);
    }
    console.log(`block hash: ${transactionReceipt.blockHash}`);

    console.log('waiting for a couple confirmations...');
    let confirmations = 0;
    while (confirmations < 3) {
        const currentBlockNumber = web3.eth.blockNumber;
        confirmations = currentBlockNumber - transactionReceipt.blockNumber + 1;
        console.log(`confimations: ${confirmations}`);
        await sleep(1000);
    }
}

async function getShapeshiftDespositAddress({ withdrawalAddress, returnAddress, pairBase, pairQuote }) {
    const assetPair = pairBase + '_' + pairQuote;

    const marketinfoResponse = await fetch(`${shapeshiftAPI}/marketinfo`)
        .then(res => res.json());

    const assetsMarketInfo = marketinfoResponse.filter(info => assetPair === info.pair);
    console.log(assetsMarketInfo);
    assert.equal(assetsMarketInfo.length, 1, 'no asset market info for ' + assetPair);

    const getcoinsResponse = await fetch(`${shapeshiftAPI}/getcoins`)
        .then(res => res.json());
    const assetsUnavailable = _.pickBy(getcoinsResponse,
        coin => coin.status === 'unavailable' && [pairBase, pairQuote].includes(coin.symbol)
    );
    assert.equal(Object.keys(assetsUnavailable).length, 0, 'assets unavailable');

    assert(await fetch(`${shapeshiftAPI}/validateAddress/${returnAddress}/${pairBase}`)
    .then(res => res.json()).then(res => res.isvalid), 'return address invalid');
    assert(await fetch(`${shapeshiftAPI}/validateAddress/${withdrawalAddress}/${pairQuote}`)
        .then(res => res.json()).then(res => res.isvalid), 'withdrawal address invalid');

    const shiftResponse = await fetch(`${shapeshiftAPI}/shift`, {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        method: 'POST',
        body: JSON.stringify({
            withdrawal: withdrawalAddress,
            pair: assetPair,
            returnAddress: returnAddress
        })
    })
        .then(res => res.json());
    console.log(shiftResponse);
    assert(shiftResponse.deposit &&
        shiftResponse.depositType === pairBase &&
        shiftResponse.withdrawal === withdrawalAddress &&
        shiftResponse.withdrawalType === pairQuote &&
        shiftResponse.returnAddress === returnAddress &&
        shiftResponse.returnAddressType === pairBase,
        'shiftResponse invalid'
    );

    return shiftResponse.deposit;
}

(async function () {
    try {
        // ------------------------------------------------------------------------
        // shapeshift Ether to ERC20
        // ------------------------------------------------------------------------

        const etherDepositAddress = await getShapeshiftDespositAddress({
            withdrawalAddress: fundsAddress,
            returnAddress: fundsAddress,
            pairBase: 'ETH',
            pairQuote: erc20Symbol
        });
        console.log(`shapeshift ETH deposit address: ${etherDepositAddress}`);

        console.log('depositing ETH to shapeshift...')
        await transfer({
            from: fundsAddress,
            to: etherDepositAddress,
            // shapeshift just half of ETH available
            // to afford this transaction fee and another to shapeshift all ERC20 back to Ether
            amount: Math.floor(web3.eth.getBalance(fundsAddress) / 2),
            privateKey: fundsAddressPrivateKey
        });

        // ------------------------------------------------------------------------
        // shapeshift ERC20 back to Ether
        // ------------------------------------------------------------------------

        const contractAddress = getContractAddress(erc20Symbol);
        console.log(`${erc20Symbol} contract address: ${contractAddress}`);

        const contract = web3.eth.contract(erc20abi).at(contractAddress);
        console.log(`${erc20Symbol} contract name: ${contract.name()}`);
        assert.equal(contract.symbol(), erc20Symbol, 'contract symbol incorrect');        

        console.log(`polling for nonzero ${contract.symbol()} balance at ${fundsAddress}`);
        let erc20Balance = 0;
        while (erc20Balance === 0) {
            erc20Balance = contract.balanceOf(fundsAddress).toNumber();
            await sleep(1000);
        }
        console.log(`${erc20Symbol} balance: ${erc20Balance}`);

        const erc20DepositAddress = await getShapeshiftDespositAddress({
            withdrawalAddress: fundsAddress,
            returnAddress: fundsAddress,
            pairBase: erc20Symbol,
            pairQuote: 'ETH'
        });
        console.log(`shapeshift ${erc20Symbol} deposit address: ${etherDepositAddress}`);

        console.log(`depositing ${erc20Balance} ${erc20Symbol} to shapeshift...`)
        await transfer({
            from: fundsAddress,
            to: erc20DepositAddress,
            // shapeshift all available ERC20
            // so there should be sufficient ETH to pay transaction fee
            amount: erc20Balance,
            privateKey: fundsAddressPrivateKey,
            contract
        });
    } catch (err) {
        console.error(err);
    }
})();