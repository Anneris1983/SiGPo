# SiGPo — Notas de proyecto

## Reglas de trabajo (pedidas por Anneris)
- **No rellenar los huecos con suposiciones, confirmar siempre.**
- Nunca usar Python/sed para reconstruir archivos — solo el tool Edit con bloques exactos ya leídos.
- Siempre leer antes de editar. Después de cada Edit, verificar con grep/Read.
- Un cambio por commit.

## Infraestructura (NO volver a preguntar)
- **GitHub Pages publica desde la rama `desarrollo-38`.** Es la rama de producción en vivo. NO es `main`. Pushear a `desarrollo-38` pone los cambios en vivo. (Antes producción era `desarrollo-36`; se movió a `desarrollo-38`.)
- Historial de ramas: `desarrollo-38` salió de `desarrollo-37`, que salió de `desarrollo-36`.
- **Migración a GitHub institucional:** el proyecto se va a copiar al repo `POSGRADOFCEUNCUYO/pagos-cobranzas` (cuenta institucional). Esa migración la hace Anneris manualmente (import de GitHub); no requiere acción del asistente.
