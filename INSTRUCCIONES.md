# 🐾 VetAI Assistant — Guía de Instalación

## Qué tienes aquí

```
vetai-backend/
├── server.js          ← El servidor (cerebro de todo)
├── prompts.js         ← Los prompts secretos (tu propiedad intelectual)
├── package.json       ← Dependencias
├── .env.example       ← Plantilla de configuración
└── public/
    ├── index.html     ← La app que usan las clínicas
    └── admin.html     ← Tu panel de administración
```

## Cómo funciona

```
Clínica abre la app → Escribe notas → Pulsa "Generar"
        ↓
Tu servidor recibe la petición
        ↓
Comprueba: ¿tiene crédito? ¿puede usar ese modelo?
        ↓
Añade los prompts secretos (la clínica no los ve)
        ↓
Llama a OpenRouter con TU API Key maestra
        ↓
Registra el consumo de la clínica
        ↓
Devuelve el informe a la clínica
```

---

## PASO 1: Cuenta en OpenRouter (5 minutos)

1. Ve a **https://openrouter.ai** y crea una cuenta
2. Ve a **Settings → Credits** y añade créditos ($10-20 para empezar)
3. Ve a **Settings → API Keys** y crea una key
4. Copia la key (empieza por `sk-or-v1-...`)

---

## PASO 2: Desplegar el servidor en Railway (10 minutos)

Railway es el más fácil. Tiene plan gratuito.

### Opción A: Desde GitHub (recomendado)

1. Crea una cuenta en **https://github.com** (si no la tienes)
2. Crea un repositorio nuevo (privado)
3. Sube todos los archivos de la carpeta `vetai-backend/`
4. Ve a **https://railway.app** y crea cuenta (usa tu GitHub)
5. Click en **"New Project"** → **"Deploy from GitHub repo"**
6. Selecciona tu repositorio
7. Railway detecta que es Node.js y lo despliega

### Opción B: Desde la terminal (si tienes Node.js)

```bash
# Instala Railway CLI
npm install -g @railway/cli

# En la carpeta del proyecto
cd vetai-backend
railway login
railway init
railway up
```

### Configurar variables de entorno en Railway:

En Railway, ve a tu proyecto → **Variables** y añade:

```
OPENROUTER_API_KEY = sk-or-v1-tu-key-aqui
ADMIN_PASSWORD = una-contraseña-segura-para-ti
```

### Obtener la URL pública:

Railway te da una URL tipo: `https://vetai-backend-xxxx.up.railway.app`

**¡Esa es la URL de tu app!**

---

## PASO 3: Acceder a tu panel de admin

Abre: `https://TU-URL.railway.app/admin.html`

1. Introduce tu contraseña de admin
2. Verás el panel con estadísticas
3. Click en **"+ Nueva clínica"** para dar de alta una clínica
4. Rellena nombre, plan y límite mensual
5. Te dará un **TOKEN** → dáselo a la clínica

---

## PASO 4: La clínica usa la app

La clínica abre: `https://TU-URL.railway.app`

1. Introduce el token que le diste
2. Ya puede usar todas las herramientas
3. El consumo se registra automáticamente

---

## Modelo de negocio sugerido

### Planes que puedes ofrecer:

| Plan | Mensualidad | Límite API | Modelos |
|------|-------------|------------|---------|
| Básico | 29€/mes | $10/mes (~300 informes) | Sonnet 4, Gemini Flash |
| Pro | 59€/mes | $30/mes (~1000 informes) | + Sonnet 4.5, GPT-4o |
| Premium | 99€/mes | $80/mes (~2500 informes) | + Opus 4 |

### Coste real por informe (aproximado):

| Modelo | Coste por informe |
|--------|-------------------|
| Gemini 2.5 Flash | ~$0.001 (casi gratis) |
| Claude Sonnet 4 | ~$0.02 |
| Claude Sonnet 4.5 | ~$0.02 |
| GPT-4o | ~$0.015 |
| Claude Opus 4 | ~$0.10 |

### Tu margen:

Si una clínica paga 59€/mes y consume $15 en API:
- **Tu ingreso**: 59€
- **Tu coste**: ~$15 ≈ 14€
- **Tu margen**: ~45€/mes por clínica

---

## Comandos útiles

### Ver el estado del servidor:
```
GET https://TU-URL/api/health
```

### Ver todas las clínicas (desde terminal):
```bash
curl -H "x-admin-password: TU-CONTRASEÑA" https://TU-URL/api/admin/dashboard
```

### Crear clínica por API:
```bash
curl -X POST -H "Content-Type: application/json" \
  -H "x-admin-password: TU-CONTRASEÑA" \
  -d '{"name":"Clínica Ejemplo","plan":"pro","monthly_limit_usd":50}' \
  https://TU-URL/api/admin/clinics
```

---

## Alternativas a Railway

| Servicio | Coste | Dificultad |
|----------|-------|------------|
| **Railway** | Gratis / $5 mes | ⭐ Muy fácil |
| **Render** | Gratis | ⭐ Muy fácil |
| **Fly.io** | Gratis | ⭐⭐ Fácil |
| **Vercel** | Gratis | ⭐⭐ Fácil (diferente config) |
| **VPS propio** | $5-10 mes | ⭐⭐⭐ Técnico |

---

## Seguridad: cosas importantes

1. **Nunca compartas tu `OPENROUTER_API_KEY`** con las clínicas
2. **Cambia la contraseña de admin** (no uses "admin123")
3. Los **prompts** están en el servidor, las clínicas no los ven
4. Cada clínica tiene su **token único** que puedes revocar
5. Los **límites de gasto** impiden sustos en la factura

---

## ¿Necesitas ayuda?

Si algo no funciona:
1. Abre `https://TU-URL/api/health` → debe decir `{"status":"ok"}`
2. Revisa las variables de entorno en Railway
3. Mira los logs en Railway → tu proyecto → "Logs"
