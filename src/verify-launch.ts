import "dotenv/config";
import { fetchFirstBuyInfo } from "./launch-tx.js";

const cases: Array<[string, number, number]> = [
  ["2KfYd9guMcoTm6DYMYB8WiiNFKPKQFdxHVkzioCSpump", 4, 0.011851852],
  ["6F9quWV7pr5Kx9MaGZRFo1v28yRm1yYwM8o6Xe3vpump", 3.0375, 0.009],
  ["HbzU4ZmDECvfSxQHcFa8a54ewaNsVvMW2bgvdeawpump", 0.999772317, 0.00089088],
  ["5SX8wH2MBkJER9THthRmmirjeHhgudwmMVUpNx2Rpump", 0.999772317, 0.00089088],
];

for (const [mint, expSwap, expFee] of cases) {
  const info = await fetchFirstBuyInfo(mint);
  const okSwap = info !== null && Math.abs(info.firstSwapSol - expSwap) < 1e-6;
  const okFee = info !== null && Math.abs(info.firstBuyCreatorFeeSol - expFee) < 1e-9;
  console.log(mint.slice(0, 8), info, okSwap && okFee ? "PASS" : "FAIL");
}
