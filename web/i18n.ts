import { computed, ref } from "vue";

export type Locale = "zh-CN" | "en-US";

const messages = {
    "zh-CN": {
        subtitle: "浏览器内视频转 Minecraft 坐垫数据包",
        settings: "生成设置", video: "视频", output: "输出", mode: "转换模式",
        resolution: "屏幕尺寸", width: "宽度", height: "高度", clip: "视频片段",
        start: "开始秒数", end: "结束秒数", invert: "反转颜色", macroUuid: "宏 + 固定 UUID",
        macroUuidHint: "使用 storage 宏，只通过固定 UUID 更新变化坐垫。",
        upload: "选择视频", drop: "点击或拖入视频文件", local: "视频和数据包始终在本机浏览器内处理。",
        generate: "生成数据包", download: "下载 ZIP", processing: "正在处理", idle: "等待视频",
        wasm: "加载 FFmpeg WASM", decode: "解码为 20 FPS", generateStage: "生成帧函数",
        zip: "压缩数据包", done: "生成完成", failed: "生成失败", selected: "已选择",
        memory: "浏览器内存提示", memoryText: "完整视频可能需要数 GiB 内存。建议先生成 5 秒片段验证效果。",
        language: "语言", theme: "主题", light: "浅色", dark: "深色", clearEnd: "留空表示视频结束",
        modeNearest: "校色最近色", modeDither: "Floyd-Steinberg", modeOrdered: "4×4 有序抖动",
        modeBinary: "黑白二值", modeGrayDither: "黑白 Floyd-Steinberg", modeGrayOrdered: "黑白 4×4 有序抖动",
        modeRgbwNearest: "RGBW 最近色", modeRgbwDither: "RGBW 误差扩散",
        threshold: "黑白阈值", invalidClip: "结束时间必须大于开始时间。", noFile: "请先选择视频文件。",
        sizeLimit: "宽高乘积不能超过 32768。", completed: "ZIP 已准备好，可以下载。",
    },
    "en-US": {
        subtitle: "Video to Minecraft cushion datapack, entirely in your browser",
        settings: "Generation settings", video: "Video", output: "Output", mode: "Conversion mode",
        resolution: "Screen size", width: "Width", height: "Height", clip: "Video clip",
        start: "Start second", end: "End second", invert: "Invert colors", macroUuid: "Macros + fixed UUIDs",
        macroUuidHint: "Store frame states in storage and address changed cushions only by fixed UUID.",
        upload: "Choose video", drop: "Click or drop a video file", local: "Videos and datapacks stay inside your browser.",
        generate: "Generate datapack", download: "Download ZIP", processing: "Processing", idle: "Waiting for video",
        wasm: "Loading FFmpeg WASM", decode: "Decoding at 20 FPS", generateStage: "Writing frame functions",
        zip: "Compressing datapack", done: "Generation complete", failed: "Generation failed", selected: "Selected",
        memory: "Browser memory", memoryText: "A full video can require several GiB of memory. Generate a 5-second clip first.",
        language: "Language", theme: "Theme", light: "Light", dark: "Dark", clearEnd: "Leave empty for the full video",
        modeNearest: "Calibrated nearest", modeDither: "Floyd-Steinberg", modeOrdered: "4×4 ordered dither",
        modeBinary: "Binary B/W", modeGrayDither: "B/W Floyd-Steinberg", modeGrayOrdered: "B/W 4×4 ordered dither",
        modeRgbwNearest: "RGBW nearest", modeRgbwDither: "RGBW error diffusion",
        threshold: "B/W threshold", invalidClip: "End time must be greater than start time.", noFile: "Choose a video first.",
        sizeLimit: "Width multiplied by height cannot exceed 32768.", completed: "The ZIP is ready to download.",
    },
} as const;

export const locale = ref<Locale>((localStorage.getItem("locale") as Locale) || "zh-CN");
export const t = computed(() => messages[locale.value]);

export function setLocale(value: Locale): void {
    locale.value = value;
    localStorage.setItem("locale", value);
    document.documentElement.lang = value;
}
