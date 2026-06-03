-- Permite file_type = 'md' em bancos já existentes.
-- Rode uma vez no SQL editor do Supabase.
alter table documents drop constraint if exists documents_file_type_check;
alter table documents add constraint documents_file_type_check
  check (file_type in ('pdf', 'txt', 'md'));
