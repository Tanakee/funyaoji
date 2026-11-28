// スクリーンの UI から使う入り口。物理・描画・ルールは game.ts と sim.ts・view.ts にある
export { createGame } from "./game.ts";
export { attachKeyboard, KEYBOARD_KEYS, type KeyboardHandle } from "./keyboard.ts";
export { SCREEN_LAYOUT, screenLayoutCssVars, screenScale } from "./layout.ts";
// 入力の初期値。キーボードだけで遊ぶとき、これで inputs を初期化する
export { NEUTRAL_INPUTS } from "./body.ts";
// お手本の歩き方。デバッグ用の自動操作と、テストで使う
export { demoGait } from "./demo.ts";
export type { UncleArt, PartImage, Expression } from "./art.ts";
export { loadUncleArt } from "./art-load.ts";
export { UNCLE_ART } from "./uncle-art/uncle-art.ts";
export { PLACEHOLDER_ART } from "./uncle-art/placeholder/placeholder.ts";
