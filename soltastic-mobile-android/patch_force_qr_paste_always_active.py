from pathlib import Path
import re
import subprocess
import sys

p = Path("App.tsx")
if not p.exists():
    raise SystemExit("App.tsx not found. Run from project root")

s = p.read_text(encoding="utf-8")
backup = p.with_suffix(".tsx.bak-force-qr-paste-always-active")
backup.write_text(s, encoding="utf-8")

# ---------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------
def ensure_rn_import(name: str) -> None:
    global s
    m = re.search(r"import \{([\s\S]*?)\} from 'react-native';", s)
    if not m:
        return
    items = [x.strip() for x in m.group(1).replace("\n", " ").split(",") if x.strip()]
    if name not in items:
        items.append(name)
    new_import = "import {\n  " + ",\n  ".join(dict.fromkeys(items)) + ",\n} from 'react-native';"
    s = s[:m.start()] + new_import + s[m.end():]

ensure_rn_import("Pressable")
ensure_rn_import("TouchableOpacity")

if "@expo/vector-icons" not in s:
    m = re.search(r"import \{[\s\S]*?\} from 'react-native';\n", s)
    s = s[:m.end()] + "import { Ionicons } from '@expo/vector-icons';\n" + s[m.end():] if m else "import { Ionicons } from '@expo/vector-icons';\n" + s

if "expo-clipboard" not in s:
    m = re.search(r"import \{[\s\S]*?\} from 'react-native';\n", s)
    s = s[:m.end()] + "import * as Clipboard from 'expo-clipboard';\n" + s[m.end():] if m else "import * as Clipboard from 'expo-clipboard';\n" + s

# ---------------------------------------------------------------------
# Detect state setter and QR handler.
# ---------------------------------------------------------------------
def find_setter(state_name: str) -> str | None:
    m = re.search(rf"const \[{state_name}\s*,\s*([A-Za-z0-9_]+)\]\s*=\s*useState", s)
    return m.group(1) if m else None

receiver_state = "receiverAddress"
receiver_setter = None
for candidate in ["receiverAddress", "receiver", "toAddress", "recipientAddress"]:
    setter = find_setter(candidate)
    if setter:
        receiver_state = candidate
        receiver_setter = setter
        break

if not receiver_setter:
    receiver_setter = "setReceiverAddress"

qr_handler = None
for pat in [
    r"const\s+(openQrScanner)\s*=\s*useCallback",
    r"const\s+(scanQrPress)\s*=\s*useCallback",
    r"onPress=\{(openQrScanner|scanQrPress)\}",
]:
    m = re.search(pat, s)
    if m:
        qr_handler = m.group(1)
        break

if not qr_handler:
    qr_handler = "openQrScanner"

# ---------------------------------------------------------------------
# Paste handler. Keep it independent from busy.
# ---------------------------------------------------------------------
if "const pasteReceiverPress = useCallback" not in s:
    insert_at = s.find("  const sendTransferPress = useCallback")
    if insert_at == -1:
        insert_at = s.find("  const canSend =")
    if insert_at == -1:
        insert_at = s.find("  return (")
    if insert_at == -1:
        raise SystemExit("Could not insert pasteReceiverPress")

    handler = f"""
  const pasteReceiverPress = useCallback(async () => {{
    try {{
      const text = await Clipboard.getStringAsync();

      if (!text || !text.trim()) {{
        addLog('Clipboard is empty.', 'err');
        return;
      }}

      {receiver_setter}(text.trim());
      addLog('Receiver address pasted.', 'ok');
    }} catch (e) {{
      const msg = typeof errorToText === 'function' ? errorToText(e) : String(e);
      addLog(`Paste failed: ${{msg}}`, 'err');
    }}
  }}, [addLog]);

"""
    s = s[:insert_at] + handler + s[insert_at:]

# ---------------------------------------------------------------------
# Force receiver row to permanent icon buttons.
# Finds the row by the placeholder "Receiver Solana address".
# ---------------------------------------------------------------------
address_row = f"""              <View style={{styles.addressRow}}>
                <TextInput
                  value={{{receiver_state}}}
                  onChangeText={{{receiver_setter}}}
                  placeholder="Receiver Solana address"
                  placeholderTextColor="#6b7280"
                  autoCapitalize="none"
                  autoCorrect={{false}}
                  style={{[styles.input, styles.addressInput]}}
                />

                <Pressable
                  onPress={{pasteReceiverPress}}
                  style={{({{ pressed }}) => [
                    styles.squareIconButton,
                    pressed ? styles.buttonPressed : null,
                  ]}}
                  accessibilityLabel="Paste receiver address"
                >
                  <Ionicons name="clipboard-outline" size={{24}} color="#071019" />
                </Pressable>

                <Pressable
                  onPress={{{qr_handler}}}
                  style={{({{ pressed }}) => [
                    styles.squareIconButton,
                    pressed ? styles.buttonPressed : null,
                  ]}}
                  accessibilityLabel="Scan receiver QR code"
                >
                  <Ionicons name="qr-code-outline" size={{25}} color="#071019" />
                </Pressable>
              </View>"""

# Try replacing whole address row.
row_pattern = re.compile(
    r"\n\s*<View style=\{styles\.addressRow\}>[\s\S]*?Receiver Solana address[\s\S]*?\n\s*</View>",
    re.S,
)
s2, n = row_pattern.subn("\n" + address_row, s, count=1)
if n:
    s = s2
else:
    # Fallback: replace from TextInput placeholder through the old Scan QR button's closing line.
    fallback = re.compile(
        r"\n\s*<TextInput[\s\S]*?placeholder=\"Receiver Solana address\"[\s\S]*?(?:<Button[\s\S]*?title=\"Scan QR\"[\s\S]*?/>|<TouchableOpacity[\s\S]*?(?:Scan QR|qr-code-outline)[\s\S]*?</TouchableOpacity>)",
        re.S,
    )
    s2, n = fallback.subn("\n" + address_row, s, count=1)
    if n:
        s = s2
    else:
        raise SystemExit("Could not find receiver address row. Send: nl -ba App.tsx | sed -n '1120,1235p'")

# Remove any residual textual Scan QR button if duplicate survived.
s = re.sub(
    r"\n\s*<Button\b(?=[^>]*title=['\"]Scan QR['\"])[^>]*/>",
    "",
    s,
    flags=re.S,
)

# ---------------------------------------------------------------------
# Make QR/Paste independent from global busy.
# If old code still has disabled={busy} on QR-related buttons, remove it.
# ---------------------------------------------------------------------
s = re.sub(
    r"(<Button\b(?=[^>]*title=['\"]Scan QR['\"])[^>]*?)\s+disabled=\{[^}]*\}",
    r"\1",
    s,
    flags=re.S,
)
s = re.sub(
    r"(<TouchableOpacity\b(?=[\s\S]{0,260}(?:qr-code-outline|Scan QR|pasteReceiverPress))[\s\S]*?)\s+disabled=\{[^}]*\}",
    r"\1",
    s,
    flags=re.S,
)
s = s.replace("styles.squareActionButton", "styles.squareIconButton")

# ---------------------------------------------------------------------
# Optional: header spinner should not block QR. Rename visual spinner condition
# from busy to busy && !serverState? No, safer: leave logic, only UI buttons fixed.
# ---------------------------------------------------------------------

# ---------------------------------------------------------------------
# Styles.
# ---------------------------------------------------------------------
def replace_or_add_style(name: str, code: str) -> None:
    global s
    pattern = re.compile(rf"\n\s*{re.escape(name)}:\s*\{{[\s\S]*?\n\s*\}},", re.S)
    if pattern.search(s):
        s = pattern.sub(code, s, count=1)
    else:
        pos = s.rfind("\n});")
        if pos == -1:
            raise SystemExit(f"Could not insert style {name}")
        s = s[:pos] + code + s[pos:]

replace_or_add_style("addressRow", """
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 10,
  },""")

replace_or_add_style("addressInput", """
  addressInput: {
    flex: 1,
    minWidth: 0,
    marginTop: 0,
  },""")

replace_or_add_style("squareIconButton", """
  squareIconButton: {
    width: 54,
    height: 54,
    flexShrink: 0,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14f195',
    marginLeft: 8,
  },""")

if "buttonPressed:" not in s:
    pos = s.rfind("\n});")
    if pos != -1:
        s = s[:pos] + """
  buttonPressed: {
    opacity: 0.75,
  },""" + s[pos:]

for key in ["addressRow", "addressInput", "squareIconButton", "buttonPressed"]:
    s = s.replace(f"\n  }}\n  {key}:", f"\n  }},\n  {key}:")

p.write_text(s, encoding="utf-8")

# Parse check
node_script = """
const fs = require('fs');
const parser = require('@babel/parser');
const src = fs.readFileSync('App.tsx', 'utf8');
parser.parse(src, {
  sourceType: 'module',
  plugins: ['typescript', 'jsx'],
});
console.log('Babel parse OK');
"""
res = subprocess.run(["node", "-e", node_script], text=True, capture_output=True)
if res.returncode != 0:
    print("Babel parse failed after patch:")
    print(res.stderr or res.stdout)
    print()
    print("Show address row:")
    print("  nl -ba App.tsx | sed -n '1120,1235p'")
    sys.exit(res.returncode)

print(res.stdout.strip())
print("Patched QR/Paste row: buttons are always rendered and not tied to busy.")
print(f"Backup: {backup}")
print()
print("Verify:")
print("  grep -n \"Scan QR\\|clipboard-outline\\|qr-code-outline\\|Pressable\\|addressRow\\|squareIconButton\" App.tsx")
print()
print("Run:")
print("  npx expo start --dev-client --android -c")
print()
print("If running installed APK, rebuild it:")
print("  npx expo prebuild --platform android")
print("  cd android && ./gradlew :app:assembleRelease")
