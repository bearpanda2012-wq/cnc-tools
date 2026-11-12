# CNC Tools 🛠️

ชุดเครื่องมือช่วยงาน CNC มีทั้งแอปที่เปิดผ่านเบราว์เซอร์ได้ทันที และ Carving Studio ที่รันผ่าน Node.js ในเครื่องเพื่อเชื่อมต่อ AI ผ่าน MCP

## เครื่องมือในชุดนี้

| เครื่องมือ | คำอธิบาย | ลิงก์ |
|---|---|---|
| 🖼️ **CNC Pattern Generator** | แปลงรูปภาพเป็น Tool Path สำหรับงาน CNC | [`/pattern-generator/`](pattern-generator/) |
| 📐 **SheetCNC Pro** | ถอดแผ่นและจัดวางชิ้นงานบนแผ่นวัสดุ (Nesting) พร้อม export Excel | [`/sheetcnc/`](sheetcnc/) |
| ✒️ **LineTracer Pro** | คัดลอกลายเส้นจากรูปภาพเป็นเส้นเวกเตอร์ สำหรับงาน CNC | [`/line-tracer/`](line-tracer/) |
| 🗿 **Relief Studio** | แปลงรูปเป็นงานแกะนูนด้วย AI ปั้นแก้ใน 3D ส่งออก STL / Heightmap 16-bit | [`/relief/`](relief/) |
| **Carving Studio Classic + MCP** | โปรแกรมแนว ArtCAM สำหรับวาดเวกเตอร์ สร้างลายนูนไทย พรีวิวกัดหยาบ/เก็บผิว และเชื่อม AI ผ่าน MCP stdio มีรุ่น Classic และ Original — ต้องใช้ Node.js ในเครื่อง | [โปรแกรมและคู่มือติดตั้ง](carving-studio/README.md) |

## วิธีใช้งาน

สำหรับ CNC Pattern Generator, SheetCNC Pro, LineTracer Pro และ Relief Studio เปิดผ่าน GitHub Pages ได้เลย:

```
https://bearpanda2012-wq.github.io/cnc-tools/
```

หรือดาวน์โหลด repo แล้วเปิดไฟล์ `index.html` ในเบราว์เซอร์โดยตรงก็ได้ (ต้องต่ออินเทอร์เน็ต เพราะโหลด library จาก CDN)

**Carving Studio Classic + MCP** ต้องติดตั้ง Node.js 22 ขึ้นไป แล้วรันในเครื่อง ไม่ได้เปิดใช้งานผ่าน GitHub Pages โดยตรง ดู [วิธีติดตั้งและเชื่อม MCP](carving-studio/README.md) และ [ตัวอย่างลายไทยพร้อมดอกกัด](carving-studio/examples/thai-kanok/README.md)

## เทคโนโลยีที่ใช้

- HTML / CSS / JavaScript (ไฟล์เดียวจบต่อแอป ไม่ต้อง build)
- [jsPDF](https://github.com/parallax/jsPDF) — export PDF (Pattern Generator)
- [SheetJS](https://sheetjs.com/) — export Excel (SheetCNC Pro)
- React / Vite / Node.js / MCP TypeScript SDK — Carving Studio Classic และการเชื่อม AI

## โครงสร้าง Repo

```
cnc-tools/
├── index.html              ← หน้าแรก (รวมลิงก์ทุกแอป)
├── pattern-generator/
│   └── index.html          ← CNC Pattern Generator
├── sheetcnc/
│   └── index.html          ← SheetCNC Pro
├── line-tracer/
│   └── index.html          ← LineTracer Pro
├── carving-studio/        ← Classic + Original, MCP และตัวอย่างลายไทย
│   ├── artcam-classic/     ← รุ่นหน้าตาแนว ArtCAM และ MCP server
│   ├── public/            ← รุ่น Original
│   └── examples/          ← ตัวอย่างลายนูนและค่าดอกกัด
└── README.md
```

---

สร้างด้วย [Claude](https://claude.ai) 🤖


## Carving Studio Classic + MCP

เพิ่ม [Carving Studio](carving-studio/) — โปรแกรมแนว ArtCAM พร้อม MCP stdio, ลายนูนไทย และพรีวิวดอกกัดหยาบ/เก็บผิว มีทั้งรุ่น Classic และ Original ต้องติดตั้ง Node.js และรันในเครื่อง ดู [วิธีติดตั้ง](carving-studio/README.md)
