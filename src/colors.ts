export const CUSHION_COLOR_PALETTE = [
    { name: "black", red: 0x34, green: 0x33, blue: 0x43 },
    { name: "white", red: 0xe0, green: 0xe1, blue: 0xe1 },
    { name: "orange", red: 0xfb, green: 0x96, blue: 0x2d },
    { name: "magenta", red: 0xc9, green: 0x4d, blue: 0xab },
    { name: "light_blue", red: 0x2f, green: 0xa0, blue: 0xd3 },
    { name: "yellow", red: 0xf6, green: 0xd1, blue: 0x2f },
    { name: "lime", red: 0x81, green: 0xbb, blue: 0x26 },
    { name: "pink", red: 0xec, green: 0x80, blue: 0xa1 },
    { name: "gray", red: 0x63, green: 0x72, blue: 0x78 },
    { name: "light_gray", red: 0x9c, green: 0x9c, blue: 0x95 },
    { name: "cyan", red: 0x1f, green: 0x9c, blue: 0x9a },
    { name: "purple", red: 0xa1, green: 0x43, blue: 0xd0 },
    { name: "blue", red: 0x45, green: 0x65, blue: 0xb9 },
    { name: "brown", red: 0x99, green: 0x61, blue: 0x3a },
    { name: "green", red: 0x64, green: 0x7e, blue: 0x1c },
    { name: "red", red: 0xc5, green: 0x3c, blue: 0x30 },
] as const;

export type CushionColorName = typeof CUSHION_COLOR_PALETTE[number]["name"];
