import { config as dotenvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotenvConfig();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: './contracts/src',
    tests: './contracts/test',
    cache: './contracts/cache',
    artifacts: './contracts/artifacts',
  },
  networks: {
    xlayer: {
      type: 'http',
      url: process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech',
      chainId: 196,
      accounts: process.env.HOOK_DEPLOYER_PRIVATE_KEY ? [process.env.HOOK_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
