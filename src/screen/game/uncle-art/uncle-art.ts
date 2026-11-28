import type { UncleArt } from "../art.ts";

/**
 * おじさんの部位の画像。指定の無い部位は Graphics で描く。
 * このフォルダに右向きの head-normal.png、head-fell.png、torso.png、thigh.png、shin.png を置き、ここに足す。
 * ももとすねの画像には、担当の人の色（担当が居ないときは灰色）を掛けて（乗算して）描くので、色を出す所は白で描く。
 * 寸法（m）と基準点（anchor・at）の書き方は PLACEHOLDER_ART を見る
 */
export const UNCLE_ART: UncleArt = {};
