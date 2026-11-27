// スクリーンの UI から使う入り口。物理・描画・ルールは game.ts と sim.ts・view.ts にある
export { createGame } from "./game.ts";
export { attachKeyboard, KEYBOARD_KEYS } from "./keyboard.ts";
// 入力の初期値。キーボードだけで遊ぶとき、これで inputs を初期化する
export { NEUTRAL_INPUTS } from "./body.ts";
// お手本の歩き方。デバッグ用の自動操作と、テストで使う
export { demoGait } from "./demo.ts";
// 関節ごとの色（ゲームの凡例と同じ）。デバッグのつまみも同じ色にする
export { COLORS as GAME_COLORS } from "./view.ts";
