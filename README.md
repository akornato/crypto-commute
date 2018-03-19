# Crypto Commute

A simple Node.js 8.x script to trade ETH for ERC20 compatible tokens and back using [shapeshift.io](https://shapeshift.io/) instant crypto exchange.
ERC20 tokens are withdrawn to the same `fundsAddress` which contains ETH so all assets always end up associated with `fundsAddress` after each shapeshift.

## Install

`npm install`

`.env` should have `INFURA_ACCESS_TOKEN` (only if you use [Infura](https://infura.io/) instead of [Geth](https://github.com/ethereum/go-ethereum/wiki/geth)), `ETHEREUM_WALLET_DATA_DIR`, `FUNDS_ACCOUNT_ADDRESS`, `FUNDS_ACCOUNT_PASSWORD` environment variables, i.e. the script assumes [Ethereum Wallet](https://github.com/ethereum/mist/releases) to get the funds address private key `fundsAddressPrivateKey` using keythereum.

Geth should be running with --rpc flag to enable HTTP JSON-RPC for synchronous [web3.js](https://github.com/ethereum/web3.js/) calls. Or just uncomment Infura provider:

``` javascript
const web3 = new Web3(new Web3.providers.HttpProvider(`https://mainnet.infura.io/${process.env.INFURA_ACCESS_TOKEN}`));
```

ERC20 token symbol to be shapeshifted is hardcoded in `index.js`, which is all required to edit for other ERC20 tokens as the script loads `ethTokens.json` for popular token contract address lookup, and communicates with all contracts via [JSON ABI for the Ethereum ERC 20 Token Standard](https://github.com/danfinlay/human-standard-token-abi).

``` javascript
const erc20Symbol = 'EOS';
```

## Run

`npm start`