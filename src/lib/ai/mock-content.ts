import type { Category, DiagramKind, Motif } from "../types";

/**
 * Deterministic Thai content for MOCK mode. It lets the full pipeline run with
 * no API credits. Content is clearly generic and must not be published as-is.
 */

export interface MockTopic {
  title: string;
  category: Category;
  angle: string;
  learning_objective: string;
}

export const MOCK_TOPICS: MockTopic[] = [
  { title: "MSS คืออะไร และทำไมต้องรอให้ยืนยัน", category: "market_structure", angle: "definition-to-application", learning_objective: "แยก MSS จริงกับการสวิงหลอกได้" },
  { title: "HH HL LH LL อ่านโครงสร้างราคาใน 30 วินาที", category: "market_structure", angle: "rules of thumb", learning_objective: "ระบุเทรนด์จากจุดสวิงได้" },
  { title: "Liquidity Sweep กับดักที่เทรดเดอร์รายย่อยโดนบ่อย", category: "liquidity", angle: "common mistake", learning_objective: "เข้าใจว่าทำไม SL ที่วางตรงยอดชัดเจนถึงโดนกวาด" },
  { title: "Equal Highs ทำไมคือแม่เหล็กดึงราคา", category: "liquidity", angle: "mental model", learning_objective: "มองเห็นจุดสะสม Liquidity ก่อนราคาไปถึง" },
  { title: "วิธีใช้ FVG ให้ถูกต้อง ไม่ใช่เห็นช่องแล้วเข้าเลย", category: "fair_value_gap", angle: "misconception-busting", learning_objective: "ใช้ FVG ร่วมกับบริบทโครงสร้างราคา" },
  { title: "FVG ที่ดีต้องมี 3 อย่างนี้", category: "fair_value_gap", angle: "checklist", learning_objective: "คัดกรอง FVG คุณภาพสูง" },
  { title: "Order Block แบบไหนที่ควรข้าม", category: "order_blocks", angle: "comparison", learning_objective: "แยก Order Block ที่มีนัยสำคัญกับที่ไม่มี" },
  { title: "Order Block กับ Supply Demand ต่างกันตรงไหน", category: "order_blocks", angle: "comparison (A vs B)", learning_objective: "เข้าใจนิยามและการใช้งานของ OB" },
  { title: "HTF บอกทิศ LTF บอกจังหวะ", category: "multi_timeframe", angle: "timeframe alignment", learning_objective: "จัดลำดับการวิเคราะห์จาก HTF ลง LTF" },
  { title: "เทรดสวน HTF ทำไมพอร์ตถึงเหนื่อย", category: "multi_timeframe", angle: "common mistake", learning_objective: "หลีกเลี่ยงการเทรดสวนบริบทใหญ่" },
  { title: "เสี่ยง 1% ต่อไม้ ทำไมถึงช่วยให้พอร์ตรอด", category: "risk_management", angle: "mental model", learning_objective: "คำนวณความเสี่ยงต่อไม้ได้" },
  { title: "คำนวณลอตจากระยะ SL ไม่ใช่จากความมั่นใจ", category: "risk_management", angle: "step-by-step", learning_objective: "คำนวณขนาดลอตจากความเสี่ยงที่ยอมรับได้" },
  { title: "RR 1:2 ไม่ได้แปลว่าต้องชนะบ่อย", category: "risk_management", angle: "misconception-busting", learning_objective: "เข้าใจความสัมพันธ์ระหว่าง RR และอัตราชนะ" },
  { title: "Revenge Trade วงจรที่ทำลายพอร์ต", category: "trading_psychology", angle: "mental model", learning_objective: "รู้ทันอารมณ์หลังแพ้ติดกัน" },
  { title: "FOMO ตกรถแล้วต้องทำอย่างไร", category: "trading_psychology", angle: "scenario walkthrough", learning_objective: "มีแผนรับมือเมื่อพลาดจังหวะ" },
  { title: "ทำไมเทรดเดอร์ส่วนใหญ่ขาดทุน", category: "trading_mistakes", angle: "common mistake", learning_objective: "รู้จักสาเหตุหลักของการขาดทุน" },
  { title: "ขยับ SL หนีราคา ความผิดพลาดที่แพงที่สุด", category: "trading_mistakes", angle: "common mistake", learning_objective: "ยึดแผน SL ตามโครงสร้าง" },
  { title: "Smart Money Concepts คืออะไร ในภาษาคนธรรมดา", category: "ict_smc", angle: "definition-to-application", learning_objective: "เข้าใจภาพรวมของ SMC" },
  { title: "Premium กับ Discount ซื้อถูก ขายแพง แบบ ICT", category: "ict_smc", angle: "rules of thumb", learning_objective: "ใช้ Premium/Discount กรองจุดเข้า" },
  { title: "เช็กลิสต์ก่อนกดเข้าออเดอร์ 5 ข้อ", category: "practical_education", angle: "checklist", learning_objective: "มีขั้นตอนตรวจสอบก่อนเข้าเทรด" },
  { title: "บันทึกเทรดอย่างไรให้เก่งขึ้นจริง", category: "practical_education", angle: "step-by-step", learning_objective: "สร้าง Trading Journal ที่ใช้งานได้" },
  { title: "Backtest แบบไม่หลอกตัวเอง", category: "practical_education", angle: "how to verify", learning_objective: "ทดสอบกลยุทธ์อย่างเป็นระบบ" },
  { title: "BOS กับ CHoCH ต่างกันอย่างไร", category: "market_structure", angle: "comparison (A vs B)", learning_objective: "แยกสัญญาณต่อเทรนด์กับเปลี่ยนเทรนด์" },
  { title: "Drawdown 20% ต้องกำไรกี่ % ถึงจะคืนทุน", category: "risk_management", angle: "mental model", learning_objective: "เข้าใจคณิตศาสตร์ของการขาดทุน" },
];

interface LessonPack {
  foundation: string[];
  insight: string[];
  application: string[];
  highlight: string;
  diagram3: DiagramKind;
  diagram4: DiagramKind;
  motif: Motif;
}

export const LESSON_PACKS: Record<Category, LessonPack> = {
  market_structure: {
    foundation: ["โครงสร้างราคาคือลำดับของจุดสวิง High และ Low", "ขาขึ้นคือ HH และ HL ขาลงคือ LH และ LL"],
    insight: ["เมื่อราคาปิดทะลุ Swing สำคัญ แปลว่าแรงฝั่งตรงข้ามเริ่มชนะ", "ตัวอย่างสมมติ: ขาลงที่ปิดเหนือ LH ล่าสุด คือสัญญาณ MSS"],
    application: ["1. ระบุ Swing High และ Swing Low ล่าสุด", "2. รอแท่งปิดยืนยัน ไม่ใช่แค่ไส้เทียน", "3. หาจุดเข้าเมื่อราคาย่อกลับมา"],
    highlight: "ปิดแท่งยืนยัน > ไส้เทียนแตะ",
    diagram3: "market_structure",
    diagram4: "mss",
    motif: "mountain",
  },
  liquidity: {
    foundation: ["Liquidity คือกลุ่มคำสั่งที่รออยู่ เช่น SL และ Pending Order", "มักกองอยู่เหนือยอดเท่า หรือใต้ฐานเท่า"],
    insight: ["ราคาต้องการคู่สัญญา จึงมักวิ่งไปเก็บ Liquidity ก่อน", "ตัวอย่างสมมติ: ราคาทะลุยอดเดิมนิดเดียวแล้วกลับตัวแรง"],
    application: ["1. มาร์ก Equal Highs / Equal Lows", "2. รอให้เกิด Sweep แล้วดูการปิดกลับ", "3. วาง SL ให้พ้นจุดที่คนส่วนใหญ่วาง"],
    highlight: "อย่าวาง SL ตรงที่ทุกคนวาง",
    diagram3: "liquidity_sweep",
    diagram4: "liquidity_sweep",
    motif: "waves",
  },
  fair_value_gap: {
    foundation: ["FVG คือช่องว่างราคาจากแท่งเทียน 3 แท่ง", "เกิดเมื่อแท่งกลางวิ่งแรงจนไส้แท่ง 1 และ 3 ไม่ทับกัน"],
    insight: ["ช่องว่างสะท้อนความไม่สมดุลของคำสั่งซื้อขาย", "ราคามักกลับมาเติมบางส่วนก่อนไปต่อ แต่ไม่ใช่ทุกครั้ง"],
    application: ["1. ใช้ FVG ที่อยู่ตามทิศ HTF เท่านั้น", "2. รอราคากลับมาในโซน แล้วดูปฏิกิริยา", "3. วาง SL นอกโซน คำนวณลอตก่อนเข้า"],
    highlight: "FVG + บริบท = โซนน่าสนใจ",
    diagram3: "fvg",
    diagram4: "fvg",
    motif: "candles",
  },
  order_blocks: {
    foundation: ["Order Block คือแท่งสุดท้ายก่อนราคาวิ่งแรงจนเปลี่ยนโครงสร้าง", "เป็นร่องรอยของคำสั่งขนาดใหญ่"],
    insight: ["OB ที่มีนัยสำคัญต้องทำให้เกิด BOS หรือ MSS", "OB ที่ไม่มีการเปลี่ยนโครงสร้าง มักเป็นแค่แท่งธรรมดา"],
    application: ["1. หา OB ที่ทำให้เกิด BOS ชัดเจน", "2. เลือก OB ที่ยังไม่ถูกทดสอบ", "3. ใช้ร่วมกับ FVG และ Liquidity"],
    highlight: "OB ต้องมาพร้อมการเปลี่ยนโครงสร้าง",
    diagram3: "order_block",
    diagram4: "order_block",
    motif: "chess",
  },
  multi_timeframe: {
    foundation: ["Multi-Timeframe คือการดูหลาย TF เพื่อหาภาพใหญ่และจังหวะ", "HTF เช่น H4/D1 บอกทิศ LTF เช่น M5/M15 บอกจังหวะเข้า"],
    insight: ["สัญญาณ LTF ที่สวน HTF มีโอกาสล้มเหลวสูงกว่า", "ตัวอย่างสมมติ: D1 ขาขึ้น รอ M15 ย่อลงโซน Discount"],
    application: ["1. เริ่มจาก HTF หาทิศและโซนสำคัญ", "2. ลง LTF รอ MSS ตามทิศ HTF", "3. เข้าเมื่อทั้งสอง TF เห็นตรงกัน"],
    highlight: "HTF = ทิศทาง  LTF = จังหวะ",
    diagram3: "multi_timeframe",
    diagram4: "multi_timeframe",
    motif: "compass",
  },
  risk_management: {
    foundation: ["Risk Management คือการกำหนดเงินที่ยอมเสียก่อนเข้าเทรด", "นิยมเสี่ยง 0.5-1% ของพอร์ตต่อไม้"],
    insight: ["ขาดทุนติดกันเป็นเรื่องปกติของทุกระบบ", "เสี่ยงน้อยต่อไม้ ทำให้พอร์ตอยู่รอดพอให้ความได้เปรียบทำงาน"],
    application: ["1. กำหนด % ความเสี่ยงต่อไม้", "2. วาง SL ตามโครงสร้างราคา", "3. ลอต = เงินที่ยอมเสีย ÷ ระยะ SL"],
    highlight: "ลอต = เงินที่ยอมเสีย ÷ ระยะ SL",
    diagram3: "drawdown",
    diagram4: "position_sizing",
    motif: "shield",
  },
  trading_psychology: {
    foundation: ["จิตวิทยาการเทรดคือการตัดสินใจตามแผน แม้อารมณ์จะแกว่ง", "ความกลัวและความโลภทำให้เราทิ้งแผนโดยไม่รู้ตัว"],
    insight: ["หลังแพ้ สมองอยากเอาคืนทันที จึงเพิ่มลอตหรือเข้าเร็วเกินไป", "วงจรนี้ทำให้ขาดทุนเล็กกลายเป็นขาดทุนใหญ่"],
    application: ["1. ตั้งกฎหยุดเทรดเมื่อแพ้ครบ 2-3 ไม้", "2. พักหน้าจออย่างน้อย 30 นาที", "3. จดอารมณ์ลงบันทึกทุกครั้ง"],
    highlight: "แผนต้องชนะอารมณ์",
    diagram3: "psychology_cycle",
    diagram4: "checklist",
    motif: "brain",
  },
  trading_mistakes: {
    foundation: ["ความผิดพลาดส่วนใหญ่ไม่ได้มาจากกลยุทธ์ แต่มาจากวินัย", "เช่น ไม่ใช้ SL ลอตใหญ่เกิน และเทรดถี่เกินไป"],
    insight: ["ความผิดพลาดเล็กๆ ที่ทำซ้ำ จะสะสมจนพอร์ตเสียหาย", "ขาดทุน 50% ต้องกำไร 100% ถึงจะคืนทุน"],
    application: ["1. เขียนกฎ 3 ข้อที่ห้ามทำ", "2. ทบทวนบันทึกเทรดทุกสัปดาห์", "3. แก้ทีละเรื่อง ไม่ใช่ทั้งหมดพร้อมกัน"],
    highlight: "รอดก่อน แล้วค่อยโต",
    diagram3: "drawdown",
    diagram4: "checklist",
    motif: "lighthouse",
  },
  ict_smc: {
    foundation: ["SMC มองตลาดผ่านร่องรอยของผู้เล่นรายใหญ่", "องค์ประกอบหลักคือ Structure, Liquidity, OB และ FVG"],
    insight: ["รายใหญ่ต้องการ Liquidity เพื่อเปิดสถานะขนาดใหญ่", "จึงมักเห็น Sweep ก่อนการวิ่งจริง"],
    application: ["1. หาทิศจาก HTF", "2. รอ Liquidity Sweep และ MSS", "3. เข้าที่ OB หรือ FVG พร้อม SL ชัดเจน"],
    highlight: "Liquidity → MSS → Entry",
    diagram3: "liquidity_sweep",
    diagram4: "mss",
    motif: "target",
  },
  practical_education: {
    foundation: ["การเทรดที่ดีเริ่มจากกระบวนการที่ทำซ้ำได้", "ทุกออเดอร์ควรมีเหตุผล จุดเข้า SL และ TP ชัดเจน"],
    insight: ["ระบบที่ไม่มีการบันทึก จะไม่รู้ว่าอะไรได้ผลจริง", "ข้อมูลจากบันทึกช่วยตัดสินใจได้ดีกว่าความรู้สึก"],
    application: ["1. เช็กทิศ HTF และโซนสำคัญ", "2. ยืนยันจุดเข้าและวาง SL", "3. คำนวณลอต แล้วบันทึกก่อนกดเข้า"],
    highlight: "กระบวนการดี ผลลัพธ์ตามมาในระยะยาว",
    diagram3: "checklist",
    diagram4: "risk_reward",
    motif: "scale",
  },
};
