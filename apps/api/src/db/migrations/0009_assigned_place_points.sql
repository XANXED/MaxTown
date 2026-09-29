-- Точка Закреплённого места на карте. Её ставит Староста (docs/adr/0008):
-- это его ввод, а не данные 2ГИС, поэтому хранить можно.
ALTER TABLE house_assigned_places
  ADD COLUMN lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD COLUMN lon double precision CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  ADD CONSTRAINT house_assigned_places_point_complete CHECK ((lat IS NULL) = (lon IS NULL));
