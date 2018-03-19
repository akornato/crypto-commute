module.exports = {
    "extends": "eslint:recommended",
    "env": {
        "node": true,
        "es6": true // "ecmaVersion": 8 doesn't recognize Promise
    },
    "parserOptions": {
        "ecmaVersion": 8
    },
    "rules": {
        "no-console": "off",
        "no-unused-vars": "off",
        "no-constant-condition": "off"
    }
}