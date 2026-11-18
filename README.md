# 🛡️ Swiftnote - Premium AI-Powered Collaboration Notes

**Swiftnote** เป็นแอปพลิเคชันจดบันทึกระดับพรีเมียมที่รวบรวมพลังของ **AI**, การทำงานร่วมกันแบบ **Real-time Collaboration**, และความปลอดภัยระดับสูงเข้าไว้ด้วยกัน บนดีไซน์ที่ลื่นไหลสไตล์ iOS ครับ

---

## ✨ Features เด่นในแอป

- 🤖 **AI Assistant:** ใช้ปัญญาประดิษฐ์ช่วยสรุปเนื้อหาและต่อยอดไอเดียจากโน้ตของคุณ
- 👥 **Real-time Collaboration:** สร้าง Workspace ร่วมกับเพื่อนๆ เชิญสมาชิก และทำงานร่วมกันในพื้นที่แชร์
- 🗑️ **iOS-Style Swipe to Delete:** เลื่อน Card เพื่อลบไฟล์ด้วยความลื่นไหลระดับ Native และแถบสีแดง iOS Style
- ♻️ **Smart Trash Bin:** ระบบถังขยะที่กู้คืนไฟล์ได้ และมีการป้องกันด้วยพาสเวิร์ดก่อนลบถาวร
- 🔐 **Secure Passlock:** ระบบล็อกแอปด้วย Passcode และ Biometric ที่จดจำการตั้งค่าถาวรแม้เปลี่ยนธีมสี
- 🌗 **Dark Mode Support:** รองรับทั้งโหมดมืดและโหมดสว่าง ปรับเปลี่ยนได้ทันทีในหน้าตั้งค่า

---

## 🚀 วิธีการติดตั้งและเริ่มต้นใช้งาน (Installation)

### 1. ความต้องการเบื้องต้น (Prerequisites)
- [Node.js](https://nodejs.org/) (แนะนำ LTS)
- [Android Studio](https://developer.android.com/studio) (พร้อมลง Android SDK และ Emulator)
- Java Development Kit (JDK) 17+

### 2. การติดตั้ง Library ทั้งหมด
เปิด Terminal ในโฟลเดอร์โปรเจกต์แล้วรันคำสั่ง:
```bash
npm install
```

### 3. ตั้งค่าฐานข้อมูล (Neon Postgres)
คัดลอก `.env.example` เป็น `.env` แล้วใส่ `DATABASE_URL` ของ Neon (ไฟล์ `.env` ไม่ถูก commit)
```bash
npm run db:migrate
```

### 4. รันเว็บแอปในเครื่อง (Web + API)
```bash
npm run build
```
```bash
npm run serve
```
เปิด http://localhost:3000

### 5. Deploy บน Vercel
ตั้ง Environment Variable `DATABASE_URL` ในหน้า Settings ของโปรเจกต์บน Vercel แล้ว push ขึ้น GitHub
Vercel จะ build เว็บ (`dist/`) และ API (`api/router.js`) ให้อัตโนมัติ

### ระบบบัญชีและความปลอดภัย
- รหัสผ่านเก็บเป็น bcrypt hash (cost 12) ไม่มีการเก็บรหัสผ่านจริง
- Session เป็น token สุ่มใน cookie แบบ HttpOnly / SameSite=Lax / Secure เก็บเฉพาะ SHA-256 hash ในฐานข้อมูล
- จำกัดการล็อกอินผิด 5 ครั้งต่ออีเมลใน 15 นาที และบล็อกคำขอข้ามเว็บ (Origin check)
- ทุก query เป็น parameterized query และทุก route ตรวจสิทธิ์ว่าเป็นเจ้าของ / ผู้ได้รับแชร์ / สมาชิก workspace

### แชร์และเขียนร่วมกัน
- แชร์โน้ตให้บัญชีอื่นด้วยอีเมล (แก้ไขได้ / ดูได้อย่างเดียว) หรือเชิญเข้า Workspace
- โน้ตที่เปิดอยู่จะดึงการแก้ไขของคนอื่นทุก 2 วินาที และรายการโน้ตซิงก์ทุก 3 วินาที

---

## 🛠️ วิธีแก้ปัญหาเบื้องต้น (Troubleshooting)

หากพบปัญหา **Build Error** หรือแอป **ค้าง/ไม่โหลด**:

**วิธีล้างไฟล์ขยะและรันใหม่ (Clean Build):**
```bash
cd android
./gradlew clean
cd ..
npx react-native start --reset-cache
npx react-native run-android
```

---

## 📦 Tech Stack
- **Framework:** React Native
- **Styling:** Custom Design System (Vanilla CSS implementation)
- **Gestures:** React Native Gesture Handler & Reanimated
- **Icons:** Lucide React Native
- **Database:** Neon Postgres (`@neondatabase/serverless`)
- **API:** Vercel Serverless Function (`api/router.js` → `server/`)

---

**พัฒนาโดย:** [satetapongsa](https://github.com/satetapongsa)  
*โปรดให้คะแนน (Star) หากคุณชอบโปรเจกต์นี้!* ⭐
