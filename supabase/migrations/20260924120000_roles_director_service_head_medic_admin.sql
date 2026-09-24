-- Roles del sistema: director, service_head, medic y admin (AUT-02).
-- Se retiran administrative y pharmacy y se agrega medic. Falla si queda algún perfil con un rol retirado,
-- en lugar de reasignarlo en silencio.

ALTER TABLE core.user_profiles DROP CONSTRAINT user_profiles_role_check;
ALTER TABLE core.user_profiles
  ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('director', 'service_head', 'medic', 'admin'));
