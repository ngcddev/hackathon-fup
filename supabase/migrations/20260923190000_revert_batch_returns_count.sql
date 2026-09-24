-- IMP-08: core.revert_batch pasa a devolver cuántas filas revirtió (la API lo expone como
-- rows_reverted) y deja de llamar a derive_bed_inventory, que al terminar reescribía
-- rows_read y rows_loaded del lote histórico de camas con solo las camas recuperadas.
-- Las columnas reverted_by_user_id y reverted_at ya existen en audit.import_batches.
--
-- Al revertir un lote de bed_inventory, las camas importadas reemplazaron camas 'derived'
-- (mismo bed_code). Se borran las importadas y se vuelven a derivar de core.admissions solo
-- esas mismas bed_code, con la misma regla de core.derive_bed_inventory (S-09), para que la
-- capacidad no quede en cero. El lote histórico no se toca.

drop function if exists core.revert_batch(uuid, uuid);

create function core.revert_batch(p_batch_id uuid, p_actor_user_id uuid) returns int
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  b audit.import_batches%rowtype;
  v_derive_batch uuid;
  v_codes text[];
  v_deleted int;
begin
  if not exists (select 1 from core.user_profiles
                where user_id = p_actor_user_id and role = 'admin' and is_active) then
    raise exception 'Solo un administrador activo puede revertir lotes.' using errcode = '42501';
  end if;

  select * into b from audit.import_batches where batch_id = p_batch_id for update;
  if not found then
    raise exception 'El lote % no existe.', p_batch_id using errcode = 'P0002';
  end if;
  if b.load_type <> 'ui_import' or b.status <> 'applied' then
    raise exception 'Solo se revierten importaciones de la interfaz en estado applied.' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtext('core.apply_batch:' || b.target_table));

  if b.target_table = 'drug_stock' then
    delete from core.drug_stock where batch_id = p_batch_id;          -- vuelve a regir la foto anterior
    get diagnostics v_deleted = row_count;
  elsif b.target_table = 'surgery_schedules' then
    delete from core.surgery_schedules where batch_id = p_batch_id;
    get diagnostics v_deleted = row_count;
  elsif b.target_table = 'bed_inventory' then
    select array_agg(bed_code) into v_codes from core.bed_inventory where batch_id = p_batch_id;
    delete from core.bed_inventory where batch_id = p_batch_id;
    get diagnostics v_deleted = row_count;

    select batch_id into v_derive_batch from audit.import_batches
    where load_type = 'historical' and target_table = 'bed_inventory' and status = 'applied'
    order by imported_at desc limit 1;
    if v_derive_batch is not null and v_codes is not null then
      insert into core.bed_inventory (bed_code, bed_name, bed_group, bed_subgroup, is_active, data_origin, batch_id)
      select distinct on (a.bed_code) a.bed_code, a.bed_name, a.bed_group, a.bed_subgroup, true, 'derived', v_derive_batch
      from core.admissions a
      where a.hospitalized_at is not null and a.bed_code = any(v_codes)
      order by a.bed_code, a.admitted_at desc
      on conflict (bed_code) do nothing;
    end if;
    refresh materialized view concurrently core.mv_bed_occupancy_daily;
  end if;

  update audit.import_batches
  set status = 'reverted', reverted_by_user_id = p_actor_user_id, reverted_at = now()
  where batch_id = p_batch_id;
  return v_deleted;
end $$;

revoke execute on function core.revert_batch(uuid, uuid) from public;
grant execute on function core.revert_batch(uuid, uuid) to app_backend;
