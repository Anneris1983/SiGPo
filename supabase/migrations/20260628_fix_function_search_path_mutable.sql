-- Fijar search_path en las 2 funciones que quedaban con search_path mutable
-- (advisor function_search_path_mutable). Endurece contra inyeccion de search_path.
-- No cambia la logica (solo referencian objetos de public).
ALTER FUNCTION public.get_login_data(text)   SET search_path = public;
ALTER FUNCTION public.actualizar_morosidad() SET search_path = public;
