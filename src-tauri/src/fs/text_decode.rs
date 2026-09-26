//! 字节 → 文本解码：文件读取（编辑器 / Agent `read_file`）与 Git diff 预览共用。
//!
//! 旧实现一律用「字节里出现 `0x00` ⇒ 二进制」判定，UTF-16 文本会被误杀：
//! Windows PowerShell 5.1 的 `>` 重定向 / `Out-File` 默认写 UTF-16LE，每个
//! ASCII 字符后面跟一个 `\0`，于是一个普通 `.txt` 也报「是二进制文件，无法预览」。
//!
//! 判定顺序（BOM 最权威，逐级兜底）：
//! 1. UTF-8 / UTF-16LE / UTF-16BE / UTF-32LE / UTF-32BE BOM → 按 BOM 解码；
//! 2. 出现 NUL → 只认「无 BOM 的 UTF-16」（NUL 严格对齐单一奇偶位 + 数据位
//!    几乎全是可打印 ASCII），否则判二进制。ASCII + NUL 填充本身也是合法
//!    UTF-8，所以这一分支必须排在纯 UTF-8 判定之前；
//! 3. 不含 NUL 且整体是合法 UTF-8 → 原样；
//! 4. 不含 NUL、控制字符占比极低（GBK / Big5 / Shift_JIS 等单字节遗留编码）
//!    → 有损解码，至少能看；
//! 5. 以上都不成立 → `None`，调用方才报「二进制」。
//!
//! 已知边界：**无 BOM 且内容含非 ASCII** 的 UTF-16（如某些工具导出的中文
//! UTF-16）仍会判成二进制——放宽 sniff 就会把「恰好 NUL 对齐」的二进制放进来，
//! 误判代价比漏判大。Windows PowerShell 的产物都带 BOM，主路径不受影响。

/// 编码嗅探只看开头这么多字节（与 git 的 binary 判定量级一致）。
const SNIFF_LEN: usize = 4096;

/// 把文件 / blob 字节解成可预览文本；`None` 表示确实是二进制。
pub fn decode_text_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }
    if let Some(text) = decode_with_bom(bytes) {
        return Some(text);
    }
    if bytes.contains(&0) {
        // ASCII + NUL 填充本身也是合法 UTF-8，所以「出现 NUL」时不能直接放行：
        // 要么是无 BOM 的 UTF-16（PowerShell / `iconv` 产物），要么是真二进制。
        return decode_utf16_without_bom(bytes);
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Some(text.to_string());
    }
    if is_legacy_single_byte_text(bytes) {
        return Some(String::from_utf8_lossy(bytes).into_owned());
    }
    None
}

fn decode_with_bom(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some(String::from_utf8_lossy(&bytes[3..]).into_owned());
    }
    // UTF-32 的 BOM 以 UTF-16 BOM 开头，必须先判长的。
    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) {
        return Some(decode_utf32(&bytes[4..], true));
    }
    if bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF]) {
        return Some(decode_utf32(&bytes[4..], false));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some(decode_utf16(&bytes[2..], true));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some(decode_utf16(&bytes[2..], false));
    }
    None
}

fn decode_utf16(body: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn decode_utf32(body: &[u8], little_endian: bool) -> String {
    body.chunks_exact(4)
        .map(|quad| {
            let raw = [quad[0], quad[1], quad[2], quad[3]];
            let cp = if little_endian {
                u32::from_le_bytes(raw)
            } else {
                u32::from_be_bytes(raw)
            };
            char::from_u32(cp).unwrap_or(char::REPLACEMENT_CHARACTER)
        })
        .collect()
}

/// 无 BOM 的 UTF-16：ASCII 文本表现为「单双字节交替的 NUL 填充」。
/// 要求 NUL 只落在一个奇偶位（否则是真二进制），且数据位几乎全为可打印 ASCII
/// （这一条挡住 `[0xAB, 0x00, ...]` 这类恰好 NUL 对齐的二进制）。
fn decode_utf16_without_bom(bytes: &[u8]) -> Option<String> {
    let probe = &bytes[..bytes.len().min(SNIFF_LEN)];
    if probe.len() < 4 {
        return None;
    }
    let (nul_even, nul_odd) = nul_parity_counts(probe);
    // UTF-16LE 的 NUL 落在奇数下标，UTF-16BE 落在偶数下标。
    let little_endian = nul_odd > nul_even;
    let padding = nul_odd.max(nul_even);
    if padding * 100 < probe.len() * 40 {
        return None;
    }
    let data_parity = usize::from(!little_endian);
    if !mostly_printable_ascii(probe, data_parity) {
        return None;
    }
    Some(decode_utf16(bytes, little_endian))
}

fn nul_parity_counts(probe: &[u8]) -> (usize, usize) {
    let mut even = 0usize;
    let mut odd = 0usize;
    for (i, b) in probe.iter().enumerate() {
        if *b == 0 {
            if i % 2 == 0 {
                even += 1;
            } else {
                odd += 1;
            }
        }
    }
    (even, odd)
}

fn mostly_printable_ascii(probe: &[u8], parity: usize) -> bool {
    let mut printable = 0usize;
    let mut total = 0usize;
    for (i, b) in probe.iter().enumerate() {
        if i % 2 != parity {
            continue;
        }
        total += 1;
        if matches!(b, b'\t' | b'\n' | b'\r') || (0x20..=0x7E).contains(b) {
            printable += 1;
        }
    }
    total > 0 && printable * 100 >= total * 95
}

/// GBK / Big5 / Shift_JIS 之类单字节遗留编码：不是合法 UTF-8，但控制字符极少，
/// 仍属可读文本，有损放行（调用方已保证不含 NUL）。
fn is_legacy_single_byte_text(bytes: &[u8]) -> bool {
    let probe = &bytes[..bytes.len().min(SNIFF_LEN)];
    let control = probe
        .iter()
        .filter(|b| **b < 0x09 || (**b > 0x0D && **b < 0x20) || **b == 0x7F)
        .count();
    control * 100 <= probe.len() * 2
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le_with_bom(text: &str) -> Vec<u8> {
        let mut out = vec![0xFFu8, 0xFE];
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out
    }

    fn utf16le_no_bom(text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out
    }

    fn utf16be_with_bom(text: &str) -> Vec<u8> {
        let mut out = vec![0xFEu8, 0xFF];
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        out
    }

    fn utf16be_no_bom(text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        out
    }

    #[test]
    fn decodes_plain_utf8() {
        assert_eq!(
            decode_text_bytes(b"hello\nworld\n").as_deref(),
            Some("hello\nworld\n")
        );
    }

    #[test]
    fn decodes_utf8_with_bom_and_strips_it() {
        let mut bytes = vec![0xEFu8, 0xBB, 0xBF];
        bytes.extend_from_slice("你好".as_bytes());
        assert_eq!(decode_text_bytes(&bytes).as_deref(), Some("你好"));
    }

    #[test]
    fn decodes_empty_payload() {
        assert_eq!(decode_text_bytes(b"").as_deref(), Some(""));
    }

    /// PowerShell 5.1 `... > out.txt` 的产物：BOM + UTF-16LE。
    #[test]
    fn decodes_powershell_utf16le_txt() {
        let bytes = utf16le_with_bom("line one\nline two\n");
        assert_eq!(decode_text_bytes(&bytes).as_deref(), Some("line one\nline two\n"));
    }

    #[test]
    fn decodes_utf16be_with_bom() {
        let bytes = utf16be_with_bom("héllo");
        assert_eq!(decode_text_bytes(&bytes).as_deref(), Some("héllo"));
    }

    #[test]
    fn decodes_utf16le_without_bom() {
        let bytes = utf16le_no_bom("const a = 1;\nconst b = 2;\n");
        assert_eq!(
            decode_text_bytes(&bytes).as_deref(),
            Some("const a = 1;\nconst b = 2;\n")
        );
    }

    #[test]
    fn decodes_utf16be_without_bom() {
        let bytes = utf16be_no_bom("const a = 1;\nconst b = 2;\n");
        assert_eq!(
            decode_text_bytes(&bytes).as_deref(),
            Some("const a = 1;\nconst b = 2;\n")
        );
    }

    #[test]
    fn decodes_utf16_cjk_with_bom() {
        let bytes = utf16le_with_bom("中文内容");
        assert_eq!(decode_text_bytes(&bytes).as_deref(), Some("中文内容"));
    }

    #[test]
    fn decodes_utf32le_with_bom() {
        let mut bytes = vec![0xFFu8, 0xFE, 0x00, 0x00];
        for ch in "ok".chars() {
            bytes.extend_from_slice(&(ch as u32).to_le_bytes());
        }
        assert_eq!(decode_text_bytes(&bytes).as_deref(), Some("ok"));
    }

    #[test]
    fn rejects_png_header() {
        let png = [
            0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52,
        ];
        assert!(decode_text_bytes(&png).is_none());
    }

    #[test]
    fn rejects_nul_aligned_binary_bytes() {
        // NUL 严格奇偶对齐，但数据位不是可打印 ASCII → 仍是二进制。
        let junk: Vec<u8> = (0..64).map(|i| if i % 2 == 1 { 0x00 } else { 0xAB }).collect();
        assert!(decode_text_bytes(&junk).is_none());
    }

    #[test]
    fn rejects_elf_binary() {
        let mut elf = vec![0x7Fu8, b'E', b'L', b'F', 0x02, 0x01, 0x01, 0x00];
        elf.extend(std::iter::repeat(0x00).take(24));
        assert!(decode_text_bytes(&elf).is_none());
    }

    #[test]
    fn decodes_legacy_gbk_lossy_instead_of_binary() {
        // "中文" 的 GBK 编码：非 UTF-8，但无 NUL、控制字符极少。
        let gbk = [0xD6u8, 0xD0, 0xCE, 0xC4, 0x0A];
        let decoded = decode_text_bytes(&gbk).expect("gbk 应按可读文本放行");
        assert!(!decoded.is_empty());
    }

    #[test]
    fn rejects_utf8_text_with_stray_nul() {
        // 合法 UTF-8 但含 NUL：不是 UTF-16，也不是可读文本 → 二进制。
        assert!(decode_text_bytes(b"abc\0def\0ghi").is_none());
    }

    #[test]
    fn utf16_odd_tail_byte_is_dropped() {
        let mut bytes = utf16le_with_bom("ab");
        bytes.push(0x7A);
        assert_eq!(decode_text_bytes(&bytes).as_deref(), Some("ab"));
    }
}
