# SiGPo — Contexto del Proyecto

## Qué es
Sistema de Gestión de Pagos para Programas de Posgrado
Facultad de Ciencias Económicas — Universidad Nacional de Cuyo

## Stack: 100% WEB
- Frontend: HTML estático puro (sin frameworks, sin build)
- Backend: Supabase (PostgreSQL + Auth + Storage)
- Cliente JS: `supabase.js` — archivo central con TODAS las funciones de API
- Hosting: Netlify (archivo `_redirects` presente)
- NO hay servidor propio, NO hay Node, NO hay npm, NO hay React

## Supabase
- URL: `https://fdevypdowdhqaxvfiywt.supabase.co`
- Key: `sb_publishable_PxypVbCcQuum2EtxuJRmkg_korPHaCW`
- PAT (admin): `sbp_6bf61c1739533a6eed9159be5508f19c3f86d0e0`
- La API de Supabase está BLOQUEADA desde este entorno — solo se puede trabajar con el código

## Rama de trabajo
`claude/add-supabase-auth-SHh3v`

## Estructura de archivos
Cada archivo HTML es una pantalla. Nomenclatura: `{rol}_{numero}_{nombre}.html`
- `portal_login.html` — pública
- `index.html` — pública (redirige según rol)
- `administrador_*` — rol ADMINISTRADOR
- `secretaria_*` — rol SECRETARIA
- `coordinador_*` — rol COORDINADOR
- `cooperadora_*` — rol COOPERADORA
- `portal_estudiante_*` — rol ESTUDIANTE

## Roles y permisos
- **ADMINISTRADOR**: control total — cuotas, descuentos, alta/baja estudiantes, reclamos, importar/exportar
- **COOPERADORA**: aprueba/rechaza pagos (con recibo obligatorio), carga egresos
- **COORDINADOR**: ve pagos de su programa, envía avisos, gestiona egresos proyectados
- **SECRETARIA**: visión amplia como coordinador + define tipos/criticidad de gastos, recibe avisos automáticos
- **ESTUDIANTE**: ve sus cuotas, sube comprobantes, descarga recibos

## Reglas críticas de diseño
- TODO ES DINÁMICO — nada hardcodeado (cuotas, montos, fechas, programas, estudiantes)
- Mora: 5% mensual compuesto (configurable desde `configuracion` table)
- Emails: nunca protegidos

## Estados de cuota
| Estado | Condición |
|--------|-----------|
| `NO_ABONADA` | Tiene monto, no venció, sin comprobante |
| `PENDIENTE` | Comprobante subido, esperando revisión |
| `ABONADA` | Aprobada total por Cooperadora + recibo cargado |
| `PAGO_PARCIAL` | Aprobada parcialmente + recibo parcial |
| `EN_MORA` | Venció sin pago aprobado ni comprobante pendiente |
| `A_DEFINIR` | Existe pero sin monto cargado |

## Flujo de cuotas
```
NO_ABONADA → [estudiante sube comprobante] → PENDIENTE
PENDIENTE → [cooperadora aprueba total + recibo] → ABONADA
PENDIENTE → [cooperadora aprueba parcial + recibo] → PAGO_PARCIAL
PENDIENTE → [cooperadora rechaza] → estado real (NO_ABONADA / EN_MORA / PAGO_PARCIAL / A_DEFINIR)
NO_ABONADA → [vence sin pago] → EN_MORA
```

## Reglas de negocio clave
1. Cooperadora NO puede aprobar sin subir recibo primero
2. PENDIENTE es transitorio — rechazo siempre vuelve al estado real
3. A_DEFINIR bloquea todo flujo de pago
4. EN_MORA solo si: venció + sin pago aprobado + sin comprobante en revisión

## Tablas principales en Supabase
- `programas` — programas/cursos de posgrado
- `cohortes` — cohortes/ediciones por programa
- `estudiantes` — datos de estudiantes
- `inscripciones` — relación N:N estudiante-cohorte (con estado_academico, descuento_porcentaje)
- `cobros` — cuotas individuales por estudiante
- `pagos` — pagos parciales registrados
- `egresos` — gastos ejecutados y proyectados
- `usuarios` — usuarios del sistema con rol
- `configuracion` — parámetros globales (mora, datos bancarios, etc.)
- `notificaciones` — notificaciones por usuario/rol
- `categorias_gastos` — tipos de gastos
- `coordinadores_programas` — asignación coordinador-programa

## supabase.js — funciones clave
- `login(dni, password)` — busca email por DNI, luego autentica con Supabase Auth
- `logout()` — cierra sesión y limpia localStorage
- `requireAuth()` — verifica sesión real de Supabase, redirige a login si no hay
- `getSesion()` — lee sesión desde localStorage (solo para datos, no para auth)
- Auto-guard en DOMContentLoaded: verifica auth + rol por prefijo de página
