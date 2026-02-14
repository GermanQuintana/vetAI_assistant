// ══════════════════════════════════════════════════════
// VetAI Backend — Servidor para clínicas veterinarias
// ══════════════════════════════════════════════════════
// Este servidor:
// 1. Recibe peticiones de las clínicas
// 2. Añade los prompts secretos (tu propiedad intelectual)
// 3. Llama a OpenRouter con TU API key maestra
// 4. Controla el consumo de cada clínica
// 5. Devuelve la respuesta a la clínica
// ══════════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const PROMPTS = require("./prompts");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // Para imágenes en base64

const PORT = process.env.PORT || 3000;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "admin123";

// ══════════════════════════════════════════════
// BASE DE DATOS SIMPLE (archivo JSON)
// Para producción real usa una BD, pero esto funciona bien para empezar
// ══════════════════════════════════════════════
const DB_FILE = path.join(__dirname, "data.json");

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) { console.error("Error leyendo BD:", e); }
  return { clinics: {}, usage_log: [] };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Crear BD inicial si no existe
if (!fs.existsSync(DB_FILE)) {
  saveDB({
    clinics: {
      "demo": {
        id: "demo",
        name: "Clínica Demo",
        contact: "demo@vetai.com",
        token: "demo-token-123",
        plan: "pro",
        monthly_limit_usd: 50,
        models_allowed: ["anthropic/claude-sonnet-4", "anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4"],
        active: true,
        created: new Date().toISOString()
      }
    },
    usage_log: []
  });
  console.log("✅ Base de datos creada con clínica demo");
}

// ══════════════════════════════════════════════
// MODELOS DISPONIBLES con precios aproximados
// ══════════════════════════════════════════════
const AVAILABLE_MODELS = [
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", input_per_m: 3, output_per_m: 15, tier: "basic", desc: "Rápido y económico" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", input_per_m: 3, output_per_m: 15, tier: "pro", desc: "Inteligente y rápido" },
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", input_per_m: 15, output_per_m: 75, tier: "premium", desc: "Máxima calidad para casos complejos" },
  { id: "openai/gpt-4o", name: "GPT-4o", input_per_m: 2.5, output_per_m: 10, tier: "pro", desc: "Alternativa rápida de OpenAI" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", input_per_m: 0.15, output_per_m: 0.6, tier: "basic", desc: "Ultra económico de Google" },
];

const PLAN_TIERS = {
  basic: ["basic"],
  pro: ["basic", "pro"],
  premium: ["basic", "pro", "premium"]
};

// ══════════════════════════════════════════════
// MIDDLEWARE: Autenticar clínica
// ══════════════════════════════════════════════
function authClinic(req, res, next) {
  const token = req.headers["x-clinic-token"];
  if (!token) return res.status(401).json({ error: "Token de clínica requerido" });

  const db = loadDB();
  const clinic = Object.values(db.clinics).find(c => c.token === token);
  if (!clinic) return res.status(401).json({ error: "Token inválido" });
  if (!clinic.active) return res.status(403).json({ error: "Clínica desactivada. Contacta con el administrador." });

  req.clinic = clinic;
  next();
}

// MIDDLEWARE: Autenticar admin
function authAdmin(req, res, next) {
  const pass = req.headers["x-admin-password"];
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: "Contraseña de admin incorrecta" });
  next();
}

// ══════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════
function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getClinicMonthlyUsage(db, clinicId) {
  const monthKey = getMonthKey();
  return db.usage_log
    .filter(u => u.clinic_id === clinicId && u.month === monthKey)
    .reduce((sum, u) => sum + (u.cost_usd || 0), 0);
}

function estimateCost(model, promptTokens, completionTokens) {
  const m = AVAILABLE_MODELS.find(x => x.id === model);
  if (!m) return 0;
  return (promptTokens / 1_000_000 * m.input_per_m) + (completionTokens / 1_000_000 * m.output_per_m);
}

// ══════════════════════════════════════════════
// RUTAS DE LA CLÍNICA (las que usa la app)
// ══════════════════════════════════════════════

// Estado de la clínica (al abrir la app)
app.get("/api/clinic/status", authClinic, (req, res) => {
  const db = loadDB();
  const clinic = req.clinic;
  const usage = getClinicMonthlyUsage(db, clinic.id);
  const allowedModels = AVAILABLE_MODELS.filter(m =>
    clinic.models_allowed.includes(m.id)
  );

  res.json({
    clinic_name: clinic.name,
    plan: clinic.plan,
    monthly_limit_usd: clinic.monthly_limit_usd,
    used_this_month_usd: Math.round(usage * 10000) / 10000,
    remaining_usd: Math.round((clinic.monthly_limit_usd - usage) * 10000) / 10000,
    models: allowedModels,
    prompts_available: Object.keys(PROMPTS)
  });
});

// ══ RUTA PRINCIPAL: Generar informe ══
app.post("/api/generate", authClinic, async (req, res) => {
  const { model, prompt_type, user_content, custom_instruction } = req.body;
  const clinic = req.clinic;
  const db = loadDB();

  // 1. Verificar modelo permitido
  if (!clinic.models_allowed.includes(model)) {
    return res.status(403).json({ error: `Tu plan no incluye el modelo ${model}. Contacta con el administrador.` });
  }

  // 2. Verificar límite mensual
  const currentUsage = getClinicMonthlyUsage(db, clinic.id);
  if (currentUsage >= clinic.monthly_limit_usd) {
    return res.status(429).json({
      error: `Has alcanzado tu límite mensual de $${clinic.monthly_limit_usd}. Consumo actual: $${currentUsage.toFixed(4)}. Contacta con el administrador para ampliarlo.`
    });
  }

  // 3. Construir el prompt del sistema (SECRETO - la clínica no lo ve)
  const systemPrompt = PROMPTS[prompt_type] || PROMPTS.clinical;
  const fullSystem = systemPrompt + (custom_instruction ? "\n\nInstrucción adicional del veterinario: " + custom_instruction : "");

  // 4. Construir mensajes para OpenRouter (formato OpenAI)
  const messages = [
    { role: "system", content: fullSystem }
  ];

  // El user_content puede ser string o array (con imágenes)
  if (typeof user_content === "string") {
    messages.push({ role: "user", content: user_content });
  } else if (Array.isArray(user_content)) {
    // Convertir formato de imágenes
    const parts = user_content.map(block => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "image") return {
        type: "image_url",
        image_url: { url: "data:" + block.media_type + ";base64," + block.data }
      };
      return { type: "text", text: block.text || "" };
    });
    messages.push({ role: "user", content: parts });
  }

  // 5. Llamar a OpenRouter
  console.log(`📤 [${clinic.name}] → ${model} | prompt: ${prompt_type}`);

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENROUTER_KEY,
        "HTTP-Referer": "https://vetai.app",
        "X-Title": "VetAI Assistant"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        messages: messages
      }),
    });

    const data = await orRes.json();

    if (data.error) {
      console.error(`❌ [${clinic.name}] Error OpenRouter:`, data.error);
      return res.status(502).json({ error: "Error del modelo: " + (data.error.message || JSON.stringify(data.error)) });
    }

    const text = data.choices?.[0]?.message?.content || "";
    if (!text) {
      return res.status(502).json({ error: "El modelo devolvió una respuesta vacía. Inténtalo de nuevo." });
    }

    // 6. Registrar consumo
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    const cost = estimateCost(model, promptTokens, completionTokens);

    db.usage_log.push({
      id: uuidv4(),
      clinic_id: clinic.id,
      month: getMonthKey(),
      timestamp: new Date().toISOString(),
      model: model,
      prompt_type: prompt_type,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_usd: cost
    });
    saveDB(db);

    const newTotal = getClinicMonthlyUsage(db, clinic.id);
    console.log(`✅ [${clinic.name}] ${model} | ${promptTokens}+${completionTokens} tokens | $${cost.toFixed(5)} | mes: $${newTotal.toFixed(4)}/$${clinic.monthly_limit_usd}`);

    // 7. Devolver respuesta
    res.json({
      text: text,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost_usd: Math.round(cost * 100000) / 100000,
        month_total_usd: Math.round(newTotal * 10000) / 10000,
        month_limit_usd: clinic.monthly_limit_usd
      }
    });

  } catch (err) {
    console.error(`❌ [${clinic.name}] Error de red:`, err.message);
    res.status(500).json({ error: "Error de conexión con el servicio de IA. Inténtalo de nuevo." });
  }
});


// ══════════════════════════════════════════════
// RUTAS DE ADMINISTRACIÓN (para ti, Germán)
// ══════════════════════════════════════════════

// Ver todas las clínicas y su consumo
app.get("/api/admin/clinics", authAdmin, (req, res) => {
  const db = loadDB();
  const clinics = Object.values(db.clinics).map(c => ({
    ...c,
    token: c.token.substring(0, 8) + "...", // No mostrar token completo
    usage_this_month: Math.round(getClinicMonthlyUsage(db, c.id) * 10000) / 10000
  }));
  res.json({ clinics });
});

// Crear nueva clínica
app.post("/api/admin/clinics", authAdmin, (req, res) => {
  const { name, contact, plan, monthly_limit_usd, models_allowed } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre de clínica requerido" });

  const db = loadDB();
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-").substring(0, 30);
  const token = "vetai-" + uuidv4();

  const planModels = models_allowed || AVAILABLE_MODELS
    .filter(m => (PLAN_TIERS[plan || "pro"] || PLAN_TIERS.pro).includes(m.tier))
    .map(m => m.id);

  db.clinics[id] = {
    id,
    name,
    contact: contact || "",
    token,
    plan: plan || "pro",
    monthly_limit_usd: monthly_limit_usd || 50,
    models_allowed: planModels,
    active: true,
    created: new Date().toISOString()
  };
  saveDB(db);

  console.log(`🏥 Nueva clínica: ${name} (${id}) — Token: ${token}`);

  res.json({
    message: "Clínica creada",
    clinic: db.clinics[id],
    token: token,
    important: "⚠️ Guarda este token y dáselo a la clínica. Es su contraseña para usar la app."
  });
});

// Editar clínica
app.put("/api/admin/clinics/:id", authAdmin, (req, res) => {
  const db = loadDB();
  const clinic = db.clinics[req.params.id];
  if (!clinic) return res.status(404).json({ error: "Clínica no encontrada" });

  const { name, contact, plan, monthly_limit_usd, models_allowed, active } = req.body;
  if (name !== undefined) clinic.name = name;
  if (contact !== undefined) clinic.contact = contact;
  if (plan !== undefined) clinic.plan = plan;
  if (monthly_limit_usd !== undefined) clinic.monthly_limit_usd = monthly_limit_usd;
  if (models_allowed !== undefined) clinic.models_allowed = models_allowed;
  if (active !== undefined) clinic.active = active;

  saveDB(db);
  res.json({ message: "Clínica actualizada", clinic });
});

// Ver consumo detallado de una clínica
app.get("/api/admin/clinics/:id/usage", authAdmin, (req, res) => {
  const db = loadDB();
  const clinic = db.clinics[req.params.id];
  if (!clinic) return res.status(404).json({ error: "Clínica no encontrada" });

  const month = req.query.month || getMonthKey();
  const logs = db.usage_log.filter(u => u.clinic_id === req.params.id && u.month === month);
  const total = logs.reduce((sum, u) => sum + (u.cost_usd || 0), 0);

  // Agrupar por modelo
  const byModel = {};
  logs.forEach(u => {
    if (!byModel[u.model]) byModel[u.model] = { count: 0, cost: 0, tokens: 0 };
    byModel[u.model].count++;
    byModel[u.model].cost += u.cost_usd || 0;
    byModel[u.model].tokens += (u.prompt_tokens || 0) + (u.completion_tokens || 0);
  });

  res.json({
    clinic: clinic.name,
    month,
    total_requests: logs.length,
    total_cost_usd: Math.round(total * 10000) / 10000,
    limit_usd: clinic.monthly_limit_usd,
    by_model: byModel,
    recent: logs.slice(-20).reverse()
  });
});

// Resumen global de consumo
app.get("/api/admin/dashboard", authAdmin, (req, res) => {
  const db = loadDB();
  const month = getMonthKey();
  const monthLogs = db.usage_log.filter(u => u.month === month);
  const totalCost = monthLogs.reduce((sum, u) => sum + (u.cost_usd || 0), 0);

  const clinicsSummary = Object.values(db.clinics).map(c => {
    const usage = getClinicMonthlyUsage(db, c.id);
    return {
      id: c.id,
      name: c.name,
      plan: c.plan,
      active: c.active,
      limit: c.monthly_limit_usd,
      used: Math.round(usage * 10000) / 10000,
      percent: Math.round(usage / c.monthly_limit_usd * 100)
    };
  });

  res.json({
    month,
    total_clinics: Object.keys(db.clinics).length,
    active_clinics: Object.values(db.clinics).filter(c => c.active).length,
    total_requests_this_month: monthLogs.length,
    total_cost_this_month: Math.round(totalCost * 10000) / 10000,
    clinics: clinicsSummary,
    available_models: AVAILABLE_MODELS
  });
});

// Regenerar token de una clínica
app.post("/api/admin/clinics/:id/regenerate-token", authAdmin, (req, res) => {
  const db = loadDB();
  const clinic = db.clinics[req.params.id];
  if (!clinic) return res.status(404).json({ error: "Clínica no encontrada" });

  clinic.token = "vetai-" + uuidv4();
  saveDB(db);
  res.json({ message: "Nuevo token generado", token: clinic.token });
});

// Modelos disponibles (público)
app.get("/api/models", (req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0", openrouter_configured: !!OPENROUTER_KEY });
});

// Servir el frontend (si pones el HTML en la misma carpeta)
app.use(express.static(path.join(__dirname, "public")));

// ══════════════════════════════════════════════
// ARRANCAR SERVIDOR
// ══════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║       🐾  VetAI Backend v1.0.0  🐾          ║
  ╠══════════════════════════════════════════════╣
  ║  Servidor:  http://localhost:${PORT}            ║
  ║  OpenRouter: ${OPENROUTER_KEY ? "✅ Configurado" : "❌ FALTA API KEY"}              ║
  ║  Admin pass: ${ADMIN_PASS === "admin123" ? "⚠️  CAMBIA LA CONTRASEÑA" : "✅ Configurada"}           ║
  ╚══════════════════════════════════════════════╝

  📋 Endpoints de la clínica:
     GET  /api/clinic/status    → Estado y modelos disponibles
     POST /api/generate         → Generar informe

  🔧 Endpoints de admin:
     GET  /api/admin/dashboard  → Panel general
     GET  /api/admin/clinics    → Listar clínicas
     POST /api/admin/clinics    → Crear clínica
     PUT  /api/admin/clinics/:id → Editar clínica
     GET  /api/admin/clinics/:id/usage → Consumo detallado
  `);
});
