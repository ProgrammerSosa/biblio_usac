# Diseño: Backend — Sistema de Gestión Bibliotecaria (Facultad de Derecho USAC)

**Fecha:** 2026-09-07
**Alcance de este spec:** Backend completo (API REST). El frontend se diseña e implementa en una fase posterior, en un spec separado, una vez el backend esté funcionando.

## 1. Objetivo

Reemplazar el control manual en Excel de la Biblioteca de la Facultad de Ciencias Jurídicas y Sociales (USAC) por una API REST robusta, auditable y de $0 costo de infraestructura recurrente, que soporte: catálogo unificado de materiales, flujo de aprobación en dos filtros, auditoría inmutable de acciones, gestión de usuarios por invitación, y exportación de reportes.

## 2. Arquitectura general

Monolito modular basado en características (Feature-Based), Node.js + Express, Mongoose sobre MongoDB Atlas (free tier).

```
backend/
├── config/                   # Conexión a MongoDB (db.js), carga de variables de entorno
├── middlewares/              # verifyPortalKey, verifyJWT, checkRole, manejador global de errores
├── helpers/                  # Generación de tokens (invitación, JWT)
├── utils/                    # Respuestas HTTP estandarizadas, constantes (roles, categorías, estados)
├── src/
│   ├── auth/                 # Login, registro desde invitación
│   │   ├── auth_controller.js
│   │   ├── auth_routes.js
│   │   └── invitation_model.js
│   ├── users/                # Gestión de usuarios y generación de invitaciones (Manager)
│   │   ├── user_controller.js
│   │   ├── user_model.js
│   │   └── user_routes.js
│   ├── catalog/               # Catálogo unificado + flujo de 2 filtros
│   │   ├── catalog_controller.js
│   │   ├── catalog_model.js
│   │   └── catalog_routes.js
│   ├── audit/                 # Auditoría inmutable
│   │   ├── audit_controller.js
│   │   ├── audit_model.js
│   │   ├── audit_service.js  # función interna para registrar eventos, usada por otros controladores
│   │   └── audit_routes.js
│   └── exports/                # Generación de reportes PDF
│       ├── export_controller.js
│       └── export_routes.js
├── scripts/
│   └── seed.js                # Bootstrap del primer Manager
├── .env
├── package.json
└── server.js
```

Módulo CommonJS (`require`/`module.exports`), consistente con el ecosistema Express más común y sin necesidad de configuración adicional de `type: module`.

## 3. Modelos de datos

### 3.1 Catálogo unificado (`catalog_model.js`)

Una sola colección para las 5 categorías (no colecciones separadas ni discriminators de Mongoose) — permite listar y filtrar todo el catálogo desde un único endpoint.

**Campos comunes (todas las categorías):**

| Campo | Tipo | Notas |
|---|---|---|
| `categoria` | enum `LIBRO`, `ENCICLOPEDIA`, `REVISTA`, `DICCIONARIO`, `FOLLETO` | requerido |
| `noInventario` | String | único, indexado, ingresado manualmente por el bibliotecario |
| `autor` | String | requerido |
| `titulo` | String | requerido |
| `idioma` | String | |
| `anio` | String/Number | |
| `edicion` | String | |
| `lugar` | String | |
| `paginasImpresas` | Number | |
| `estadoFisico` | String | descripción libre (ej. "Pasta dañada, manchas de humedad") |
| `estadoRevision` | enum `PENDIENTE_ADMIN`, `PENDIENTE_MANAGER`, `APROBADO`, `RECHAZADO` | default `PENDIENTE_ADMIN` |
| `observaciones` | String | motivo de rechazo, requerido cuando `estadoRevision = RECHAZADO` |
| `registradoPor` | ObjectId ref `User` | autor original del registro |
| `revisadoPorAdmin` | ObjectId ref `User` | opcional |
| `revisadoPorManager` | ObjectId ref `User` | opcional |
| `eliminado` | Boolean | default `false`; baja lógica, excluido por defecto de `GET /catalog` |
| `createdAt` / `updatedAt` | Date | timestamps automáticos |

**Campos condicionales por categoría** (validados en un hook `pre('validate')` del schema, según la tabla de campos real extraída del Excel de la biblioteca):

| Campo | Libro | Enciclopedia | Revista | Diccionario | Folleto |
|---|---|---|---|---|---|
| `editorial` | ✓ | — | ✓ | ✓ | ✓ |
| `isbn` | ✓ | — | — | — | — |
| `issn` | — | — | ✓ | — | — |
| `volumen` | — | — | ✓ | — | — |
| `tomos` | — | ✓ | — | — | — |
| `tipoDocumento` | ✓ | — | — | — | ✓ |

El hook de validación rechaza el guardado si falta un campo requerido para la categoría dada, o si se envía un campo que no le corresponde (ej. `isbn` en una `REVISTA`).

### 3.2 Usuario (`user_model.js`)

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | String | requerido |
| `email` | String | único, requerido |
| `passwordHash` | String | generado con bcrypt |
| `rol` | enum `MANAGER`, `ADMIN`, `USER` | requerido |
| `allowedCategories` | [String] | subconjunto de las 5 categorías; solo se valida/aplica para rol `USER` |
| `createdAt` / `updatedAt` | Date | |

### 3.3 Invitación (`invitation_model.js`, dentro de `auth`)

| Campo | Tipo | Notas |
|---|---|---|
| `email` | String | requerido |
| `rol` | enum `MANAGER`, `ADMIN`, `USER` | |
| `allowedCategories` | [String] | copiado al `User` al aceptar, si aplica |
| `token` | String | único, va embebido en el `invitationLink` |
| `estado` | enum `PENDIENTE`, `ACEPTADA`, `EXPIRADA` | default `PENDIENTE` |
| `invitadoPor` | ObjectId ref `User`, nullable | `null` para la invitación de bootstrap |
| `expiresAt` | Date | 7 días desde creación |

### 3.4 Auditoría (`audit_model.js`)

| Campo | Tipo | Notas |
|---|---|---|
| `accion` | enum `CREAR`, `EDITAR`, `APROBAR`, `RECHAZAR`, `ELIMINAR`, `INVITAR`, `EXPORTAR` | |
| `entidad` | String | ej. `Catalogo`, `Usuario` |
| `entidadId` | ObjectId | |
| `usuario` | ObjectId ref `User` | quién ejecutó la acción |
| `detalles` | Mixed | snapshot relevante del cambio (ej. estado anterior → nuevo) |
| `fecha` | Date | default `Date.now` |

Sin rutas de edición ni borrado expuestas: el registro es append-only, se escribe internamente desde `audit_service.js` y solo se expone lectura filtrable vía `GET /audit`.

## 4. Seguridad y autenticación (2 niveles)

1. **Nivel 1 — Portal Gatekeeper**: middleware `verifyPortalKey` exige el header `x-portal-key` igual a `PORTAL_ACCESS_KEY` (`.env`) en **todas** las rutas de la API, incluyendo login y aceptación de invitación. Sin esta clave, ninguna petición llega a la lógica de negocio.
2. **Nivel 2 — JWT**: `POST /auth/login { email, password }` retorna un JWT firmado (expiración 12h) con `{ userId, rol }`. Middleware `verifyJWT` decodifica el token y adjunta `req.user`; middleware `checkRole(...roles)` restringe rutas por rol.

### 4.1 Invitaciones y alta de usuarios

- `POST /users/invitations` (solo `MANAGER`): recibe `{ email, rol, allowedCategories }`, crea la invitación, responde con el registro creado y un `invitationLink` (`${FRONTEND_URL}/registro?token=...`). No se envía correo real — la Manager comparte el enlace manualmente. Se registra auditoría `INVITAR`.
- `POST /auth/register-invitation { token, nombre, password }`: valida que la invitación exista, esté `PENDIENTE` y no haya expirado; crea el `User` con los datos de la invitación; marca la invitación `ACEPTADA`.

### 4.2 Bootstrap del primer Manager

`scripts/seed.js` (ejecutado con `npm run seed`):
1. Si ya existe un `User` con `rol = MANAGER`, no hace nada.
2. Si no existe, busca una invitación con `token = BOOTSTRAP_INVITE_TOKEN` (`.env`). Si no existe, la crea con `rol = MANAGER`, `invitadoPor = null`, `email` desde `.env` (`BOOTSTRAP_MANAGER_EMAIL`).
3. Imprime en consola el `invitationLink` resultante.
4. La primera persona abre ese enlace y completa su registro por el flujo normal de `POST /auth/register-invitation`, quedando como el primer Manager del sistema.

## 5. Flujo de aprobación (2 filtros) y catálogo

- `POST /catalog` (`USER`, `ADMIN` o `MANAGER`): si el usuario es `USER`, valida que `categoria` esté en su `allowedCategories`; crea el registro con `estadoRevision = PENDIENTE_ADMIN`. Auditoría `CREAR`.
- `PATCH /catalog/:id` (autor original, mientras esté `PENDIENTE_ADMIN` o `RECHAZADO`): edita campos propios. Si estaba `RECHAZADO`, al reenviar vuelve a `PENDIENTE_ADMIN`. Auditoría `EDITAR`.
- `PATCH /catalog/:id/revisar` (`ADMIN`): puede corregir campos técnicos y decidir `PENDIENTE_ADMIN → PENDIENTE_MANAGER` (Filtro 1 aprobado) o `→ RECHAZADO` (con `observaciones` obligatorias). Auditoría `APROBAR` o `RECHAZAR`.
- `PATCH /catalog/:id/aprobar` (`MANAGER`): filtro final, `PENDIENTE_MANAGER → APROBADO` o `→ RECHAZADO` (con `observaciones`). Auditoría `APROBAR` o `RECHAZAR`.
- `GET /catalog?estadoRevision=&categoria=&page=&limit=`: listado paginado y filtrable (alimenta las pestañas Pendiente Admin / Pendiente Manager / Aprobado del frontend).
- `DELETE /catalog/:id` (`MANAGER` únicamente): baja lógica — marca `eliminado: true` en vez de borrar el documento físicamente, para no perder el historial de auditoría asociado; `GET /catalog` excluye por defecto los registros con `eliminado: true`. Siempre genera auditoría `ELIMINAR`.

## 6. Auditoría

- `GET /audit?usuario=&accion=&entidad=&desde=&hasta=&page=&limit=` (`ADMIN` y `MANAGER`): lectura filtrable y paginada.
- Ningún rol puede editar o eliminar un registro de auditoría vía API — es la fuente de verdad imborrable de quién hizo qué y cuándo.

## 7. Exportaciones

- `GET /exports/catalog?estadoRevision=&categoria=` (`ADMIN` y `MANAGER`): genera un PDF con `pdfkit` (sin headless-browser, mantiene el costo en $0) listando los registros filtrados en formato de tabla. Cada exportación genera un registro de auditoría `EXPORTAR`.

## 8. Manejo de errores y respuestas

- `utils/httpResponse.js`: helper estandarizado — éxito `{ success: true, data, message? }`, error `{ success: false, error }` — usado por todos los controladores.
- Middleware global de errores en `server.js`: traduce errores de validación de Mongoose y errores de clave duplicada (`noInventario`, código Mongo `11000`) a mensajes claros en español con el código HTTP apropiado (400/409).
- Errores de autenticación/autorización (`verifyPortalKey`, `verifyJWT`, `checkRole`) responden 401/403 de forma consistente.

## 9. Pruebas

Jest + Supertest, cubriendo los flujos más riesgosos de romper:
- Middlewares de seguridad: acceso rechazado sin `x-portal-key`, sin JWT válido, o con rol insuficiente.
- Flujo completo de 2 filtros: creación → aprobación Admin → aprobación Manager (camino feliz) y camino de rechazo en cada filtro.
- Que cada acción relevante (crear, aprobar, rechazar, eliminar, invitar, exportar) efectivamente escribe un registro en `audit`.

## 10. Fuera de alcance de este spec

- Frontend (React) — spec separado, posterior.
- Envío real de correo de invitación (SMTP/Gmail) — el modelo de `Invitation` ya lo soporta, se puede añadir después sin cambios de esquema.
- Desactivación/eliminación de usuarios existentes (no solicitado; solo se cubre alta por invitación).
- Provisión del cluster de MongoDB Atlas — responsabilidad del usuario, quien debe proveer `MONGODB_URI` en `.env`.
