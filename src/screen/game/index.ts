// スクリーンの UI から使う入り口。物理・描画・ルールは game.ts と sim.ts・view.ts にある
export { createGame } from "./game.ts";
export { attachKeyboard, KEYBOARD_KEYS } from "./keyboard.ts";
// 入力の初期値。キーボードだけで遊ぶとき、これで inputs を初期化する
export { NEUTRAL_INPUTS } from "./body.ts";
