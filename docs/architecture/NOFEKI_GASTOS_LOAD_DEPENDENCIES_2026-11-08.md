# NOFEKI Platforms — revisión de carga de usuario y dependencias de Gastos

**Fecha:** 2026-11-08  
**Fuente:** lectura estática de `gastos.html` en `main`.  
**No se ejecutaron consultas en producción ni se modificó el código de la aplicación.**

## 1. Secuencia de carga actual

La función `loadUser(user)`:
1. valida que exista usuario y no esté en modo recuperación;
2. muestra el dashboard;
3. usa `loadingUserId` como guardia para evitar dos cargas simultáneas del mismo usuario;
4. carga gastos;
5. carga categorías;
6. carga presupuesto;
7. carga ingresos;
8. revisa datos locales antiguos;
9. consulta autorizaciones del Atajo;
10. carga perfil financiero.

La guardia se establece antes de la primera operación asíncrona, por lo que una segunda invocación del mismo usuario retorna mientras la primera está en curso.

## 2. Hallazgo: presupuesto consultado dos veces en la carga inicial

La función `loadExpenses()` termina llamando `loadBudget()`. Después, `loadUser()` vuelve a llamar `loadBudget()` explícitamente.

Esto significa que el presupuesto mensual puede consultarse dos veces en cada carga de usuario, junto con la consulta del historial y, si aplica, del mes anterior.

**Impacto probable:** consultas redundantes, más latencia y mayor superficie para estados de UI que se actualizan dos veces. No se observó evidencia de que esto borre o modifique datos.

**Recomendación:** en una rama de mejora separada, elegir un solo responsable de cargar presupuesto. La opción más clara es que `loadExpenses()` se limite a cargar gastos y renderizar; `loadUser()` orquesta categorías, presupuesto e ingresos. Antes de aplicar, verificar que ninguna otra llamada a `loadExpenses()` dependa implícitamente de que el presupuesto se refresque.

## 3. Hallazgo: estado global compartido

`currentUser`, `expenses`, `userCategories`, `activeBudget` y `budgetCategories` son estado compartido por varias vistas y operaciones.

**Implicación:** una integración de Platforms no debe sustituir `currentUser` por un objeto de perfil de plataforma ni cambiar su ciclo de vida. Se debe mantener la identidad Auth como fuente y añadir un contexto separado para la autorización.

## 4. Dependencias de producto a preservar

- Gastos consulta `gastos` y depende de RLS para el aislamiento del usuario.
- Categorías consulta `user_expense_categories`.
- Onboarding financiero consulta/escribe `financial_profiles`.
- Presupuesto consulta `budgets` y `budget_categories`, además de RPC `save_monthly_budget`.
- Ingresos se carga a través de `window.loadIncome()` y su tabla propia.
- Atajo usa `gestionar-atajos` con el access token actual.
- Datos locales antiguos se importan con upsert idempotente y se conservan en el navegador.

Platforms debe integrarse sin alterar esos contratos ni el orden de inicialización hasta contar con pruebas.

## 5. Recomendaciones de trabajo seguro

1. No cambiar `loadUser` ni `loadExpenses` directamente en la rama principal.
2. Si se optimiza la doble consulta, hacerlo en rama independiente y con diff mínimo.
3. Probar que presupuesto, historial, copia del mes anterior e ingresos carguen tras login y recarga.
4. No iniciar ninguna llamada de autorización de Platforms desde el callback de Auth hasta definir un guard de carga único.
5. Evitar que un fallo temporal del nuevo servicio de Platforms impida cargar gastos, movimientos, categorías, presupuesto o ingresos.

## 6. Clasificación

- **Hallazgo de eficiencia:** consulta redundante de presupuesto.
- **Control existente positivo:** guardia `loadingUserId` para evitar cargas simultáneas del mismo usuario.
- **Riesgo arquitectónico:** estado global del producto debe permanecer separado del contexto de Platforms.
- **Acción:** documentado; no se aplicó parche para proteger la operación actual.
