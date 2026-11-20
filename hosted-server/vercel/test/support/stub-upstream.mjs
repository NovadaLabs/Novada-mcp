/**
 * stub-upstream.mjs — preloaded (NODE_OPTIONS=--import) into e2e child servers
 * so the Novada wallet-balance key probe never leaves the machine: every axios
 * call answers {code:0,data:{}} (== "key accepted"). Test support only.
 */
import axios from "axios";

axios.defaults.adapter = async (config) => ({
  status: 200,
  statusText: "OK",
  headers: {},
  config,
  data: { code: 0, data: {} },
});
