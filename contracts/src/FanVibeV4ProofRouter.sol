// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Minimal proof router for FanVibe's experimental X Layer Uniswap v4 hook demo.
/// @dev Isolated from FanVibe staking, settlement, refunds, and payouts.
contract FanVibeV4ProofRouter is IUnlockCallback, Ownable {
  using BalanceDeltaLibrary for BalanceDelta;

  IPoolManager public immutable manager;

  enum Action {
    ModifyLiquidity,
    Swap
  }

  struct CallbackData {
    Action action;
    address payer;
    PoolKey key;
    ModifyLiquidityParams liquidityParams;
    SwapParams swapParams;
    bytes hookData;
  }

  event ProofLiquidityModified(address indexed payer, int24 tickLower, int24 tickUpper, int256 liquidityDelta);
  event ProofSwap(address indexed payer, bool zeroForOne, int256 amountSpecified);

  error OnlyPoolManager();
  error TransferFailed();

  constructor(IPoolManager poolManager, address initialOwner) Ownable(initialOwner) {
    manager = poolManager;
  }

  function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
    external
    payable
    onlyOwner
    returns (BalanceDelta delta)
  {
    bytes memory result = manager.unlock(abi.encode(CallbackData({
      action: Action.ModifyLiquidity,
      payer: msg.sender,
      key: key,
      liquidityParams: params,
      swapParams: SwapParams({zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0}),
      hookData: hookData
    })));
    delta = abi.decode(result, (BalanceDelta));
    emit ProofLiquidityModified(msg.sender, params.tickLower, params.tickUpper, params.liquidityDelta);
  }

  function swapExactIn(
    PoolKey calldata key,
    bool zeroForOne,
    uint128 amountIn,
    uint160 sqrtPriceLimitX96,
    bytes calldata hookData
  ) external payable onlyOwner returns (BalanceDelta delta) {
    bytes memory result = manager.unlock(abi.encode(CallbackData({
      action: Action.Swap,
      payer: msg.sender,
      key: key,
      liquidityParams: ModifyLiquidityParams({tickLower: 0, tickUpper: 0, liquidityDelta: 0, salt: bytes32(0)}),
      swapParams: SwapParams({
        zeroForOne: zeroForOne,
        amountSpecified: -int256(uint256(amountIn)),
        sqrtPriceLimitX96: sqrtPriceLimitX96
      }),
      hookData: hookData
    })));
    delta = abi.decode(result, (BalanceDelta));
    emit ProofSwap(msg.sender, zeroForOne, -int256(uint256(amountIn)));
  }

  function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
    if (msg.sender != address(manager)) revert OnlyPoolManager();
    CallbackData memory data = abi.decode(rawData, (CallbackData));

    BalanceDelta delta;
    if (data.action == Action.ModifyLiquidity) {
      (delta,) = manager.modifyLiquidity(data.key, data.liquidityParams, data.hookData);
    } else {
      delta = manager.swap(data.key, data.swapParams, data.hookData);
    }

    _settleDelta(data.key.currency0, data.payer, delta.amount0());
    _settleDelta(data.key.currency1, data.payer, delta.amount1());
    return abi.encode(delta);
  }

  function recoverToken(address token, address to, uint256 amount) external onlyOwner {
    if (!IERC20Minimal(token).transfer(to, amount)) revert TransferFailed();
  }

  function _settleDelta(Currency currency, address payer, int128 amount) private {
    if (amount < 0) {
      uint256 debt = uint256(uint128(-amount));
      manager.sync(currency);
      if (!IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(manager), debt)) {
        revert TransferFailed();
      }
      manager.settle();
      return;
    }

    if (amount > 0) {
      manager.take(currency, payer, uint256(uint128(amount)));
    }
  }
}
