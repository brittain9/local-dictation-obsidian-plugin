use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Result, bail};

pub const HY_MT_LANGUAGES: [(&str, &str, &str); 38] = [
    ("zh", "Chinese", "中文"),
    ("en", "English", "英语"),
    ("fr", "French", "法语"),
    ("pt", "Portuguese", "葡萄牙语"),
    ("es", "Spanish", "西班牙语"),
    ("ja", "Japanese", "日语"),
    ("tr", "Turkish", "土耳其语"),
    ("ru", "Russian", "俄语"),
    ("ar", "Arabic", "阿拉伯语"),
    ("ko", "Korean", "韩语"),
    ("th", "Thai", "泰语"),
    ("it", "Italian", "意大利语"),
    ("de", "German", "德语"),
    ("vi", "Vietnamese", "越南语"),
    ("ms", "Malay", "马来语"),
    ("id", "Indonesian", "印尼语"),
    ("tl", "Filipino", "菲律宾语"),
    ("hi", "Hindi", "印地语"),
    ("zh-Hant", "Traditional Chinese", "繁体中文"),
    ("pl", "Polish", "波兰语"),
    ("cs", "Czech", "捷克语"),
    ("nl", "Dutch", "荷兰语"),
    ("km", "Khmer", "高棉语"),
    ("my", "Burmese", "缅甸语"),
    ("fa", "Persian", "波斯语"),
    ("gu", "Gujarati", "古吉拉特语"),
    ("ur", "Urdu", "乌尔都语"),
    ("te", "Telugu", "泰卢固语"),
    ("mr", "Marathi", "马拉地语"),
    ("he", "Hebrew", "希伯来语"),
    ("bn", "Bengali", "孟加拉语"),
    ("ta", "Tamil", "泰米尔语"),
    ("uk", "Ukrainian", "乌克兰语"),
    ("bo", "Tibetan", "藏语"),
    ("kk", "Kazakh", "哈萨克语"),
    ("mn", "Mongolian", "蒙古语"),
    ("ug", "Uyghur", "维吾尔语"),
    ("yue", "Cantonese", "粤语"),
];

pub fn translation_prompt(source: &str, target: &str, text: &str) -> Result<String> {
    let target_names = HY_MT_LANGUAGES
        .iter()
        .find(|(code, _, _)| *code == target)
        .map(|(_, english, chinese)| (*english, *chinese))
        .ok_or_else(|| anyhow::anyhow!("unsupported target language"))?;
    if !HY_MT_LANGUAGES.iter().any(|(code, _, _)| *code == source) {
        bail!("unsupported source language");
    }
    let chinese_prompt =
        matches!(source, "zh" | "zh-Hant" | "yue") || matches!(target, "zh" | "zh-Hant" | "yue");
    Ok(if chinese_prompt {
        format!(
            "将以下文本翻译为{}，注意只需要输出翻译后的结果，不要额外解释：\n{text}",
            target_names.1
        )
    } else {
        format!(
            "Translate the following text into {}. Note that you should only output the translated result without any additional explanation:\n{text}",
            target_names.0
        )
    })
}

pub trait HyMtInference {
    fn translate(&mut self, prompt: &str, cancelled: &AtomicBool) -> Result<String>;
}

pub fn translate_units(
    inference: &mut dyn HyMtInference,
    source: &str,
    target: &str,
    texts: &[String],
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<Vec<String>> {
    let mut translations = Vec::with_capacity(texts.len());
    for (index, text) in texts.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            bail!("translation cancelled");
        }
        let prompt = translation_prompt(source, target, text)?;
        translations.push(inference.translate(&prompt, cancelled)?);
        on_progress(index + 1, texts.len());
    }
    Ok(translations)
}

#[cfg(test)]
mod tests {
    use super::{HY_MT_LANGUAGES, HyMtInference, translate_units, translation_prompt};
    use std::sync::atomic::AtomicBool;

    struct Fake;
    impl HyMtInference for Fake {
        fn translate(&mut self, prompt: &str, _: &AtomicBool) -> anyhow::Result<String> {
            Ok(format!("translated:{prompt}"))
        }
    }

    #[test]
    fn all_languages_have_prompt_names_and_all_to_all_units_stay_ordered() {
        assert_eq!(HY_MT_LANGUAGES.len(), 38);
        assert_eq!(
            translation_prompt("fr", "ja", "bonjour").unwrap(),
            "Translate the following text into Japanese. Note that you should only output the translated result without any additional explanation:\nbonjour"
        );
        assert_eq!(
            translation_prompt("zh-Hant", "en", "你好").unwrap(),
            "将以下文本翻译为英语，注意只需要输出翻译后的结果，不要额外解释：\n你好"
        );
        let result = translate_units(
            &mut Fake,
            "fr",
            "ja",
            &["un".into(), "deux".into()],
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        assert!(result[0].ends_with("un"));
        assert!(result[1].ends_with("deux"));
    }
}
