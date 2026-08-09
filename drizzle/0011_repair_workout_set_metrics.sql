UPDATE `workout_sets`
SET `actual_duration_sec` = NULL
WHERE `planned_target_type` IN ('reps', 'rounds')
  AND `actual_duration_sec` = 0;--> statement-breakpoint
UPDATE `workout_sets`
SET `actual_reps` = NULL
WHERE `planned_target_type` = 'duration'
  AND `actual_reps` = 0;--> statement-breakpoint
UPDATE `set_performances`
SET `actual_duration_sec` = NULL
WHERE `actual_duration_sec` = 0
  AND COALESCE(
    (
      SELECT `ws`.`planned_target_type`
      FROM `workout_sets` `ws`
      WHERE `ws`.`owner_email` = `set_performances`.`owner_email`
        AND `ws`.`workout_id` = `set_performances`.`session_id`
        AND `ws`.`prescribed_set_id` = `set_performances`.`prescribed_set_id`
      LIMIT 1
    ),
    CASE
      WHEN instr(lower(`target_display`), 'sec') > 0 THEN 'duration'
      WHEN instr(lower(`target_display`), 'round') > 0 OR lower(`set_type`) = 'emom' THEN 'rounds'
      ELSE 'reps'
    END
  ) IN ('reps', 'rounds');--> statement-breakpoint
UPDATE `set_performances`
SET `actual_reps` = NULL
WHERE `actual_reps` = 0
  AND COALESCE(
    (
      SELECT `ws`.`planned_target_type`
      FROM `workout_sets` `ws`
      WHERE `ws`.`owner_email` = `set_performances`.`owner_email`
        AND `ws`.`workout_id` = `set_performances`.`session_id`
        AND `ws`.`prescribed_set_id` = `set_performances`.`prescribed_set_id`
      LIMIT 1
    ),
    CASE
      WHEN instr(lower(`target_display`), 'sec') > 0 THEN 'duration'
      WHEN instr(lower(`target_display`), 'round') > 0 OR lower(`set_type`) = 'emom' THEN 'rounds'
      ELSE 'reps'
    END
  ) = 'duration';
