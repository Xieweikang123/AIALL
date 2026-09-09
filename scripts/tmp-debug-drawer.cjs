// 临时脚本：为 ChatPanel 调试按钮加「直开抽屉」行为
const fs = require("fs");
const p = "src/components/vibe/ChatPanel.vue";
let s = fs.readFileSync(p, "utf8");
const log = [];
const clickRe = /@click(\.[a-z]+)?="toggleDebug"/g;
const had = clickRe.test(s);
s = s.replace(/@click(\.[a-z]+)?="toggleDebug"/g, (m, a) => "@click" + (a || "") + '="onDebugToggle"');
if (had) log.push("click renamed");
const inj = "  if (!agentDebugEnabled.value) openLatestTraceDrawer();";
if (/function toggleDebug\s*\([^)]*\)\s*\{/.test(s)) {
  s = s.replace(/(function toggleDebug\s*\([^)]*\)\s*\{)/, "$1\n" + inj);
  log.push("injected fn");
} else if (/const toggleDebug\s*=[^=]*=>\s*\{/.test(s)) {
  s = s.replace(/(const toggleDebug\s*=[^=]*=>\s*\{)/, "$1\n" + inj);
  log.push("injected arrow");
} else if (had) {
  s = s.replace(
    /(import \{ agentDebugEnabled, setAgentDebugEnabled \} from "\.\.\/\.\.\/utils\/agentDebugFlag";)/,
    '$1\nfunction onDebugToggle() {\n' + inj + '\n  toggleDebug();\n}',
  );
  log.push("fallback def added");
} else {
  log.push("WARN: no toggleDebug usage found");
}
fs.writeFileSync(p, s);
console.log(log.join(" | "));
s.split(/\r?\n/).forEach((l, i) => {
  if (/onDebugToggle|AgentTraceDrawer|openLatestTraceDrawer/.test(l)) console.log(i + 1 + ": " + l.trim());
});