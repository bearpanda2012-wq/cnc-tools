# CNC Tools 🛠️

เครื่องมือช่วยงาน CNC ที่รันบนเบราว์เซอร์ได้เลย ไม่ต้องติดตั้งโปรแกรมใดๆ

## เครื่องมือในชุดนี้

| เครื่องมือ | คำอธิบาย | ลิงก์ |
|---|---|---|
| 🖼️ **CNC Pattern Generator** | แปลงรูปภาพเป็น Tool Path สำหรับงาน CNC | [`/pattern-generator/`](pattern-generator/) |
| 📐 **SheetCNC Pro** | ถอดแผ่นและจัดวางชิ้นงานบนแผ่นวัสดุ (Nesting) พร้อม export Excel | [`/sheetcnc/`](sheetcnc/) |

## วิธีใช้งาน

เปิดผ่าน GitHub Pages ได้เลย:

```
https://<username>.github.io/cnc-tools/
```

หรือดาวน์โหลด repo แล้วเปิดไฟล์ `index.html` ในเบราว์เซอร์โดยตรงก็ได้ (ต้องต่ออินเทอร์เน็ต เพราะโหลด library จาก CDN)

## เทคโนโลยีที่ใช้

- HTML / CSS / JavaScript (ไฟล์เดียวจบต่อแอป ไม่ต้อง build)
- [jsPDF](https://github.com/parallax/jsPDF) — export PDF (Pattern Generator)
- [SheetJS](https://sheetjs.com/) — export Excel (SheetCNC Pro)

## โครงสร้าง Repo

```
cnc-tools/
├── index.html              ← หน้าแรก (รวมลิงก์ทั้งสองแอป)
├── pattern-generator/
│   └── index.html          ← CNC Pattern Generator
├── sheetcnc/
│   └── index.html          ← SheetCNC Pro
└── README.md
```

---

สร้างด้วย [Claude](https://claude.ai) 🤖
