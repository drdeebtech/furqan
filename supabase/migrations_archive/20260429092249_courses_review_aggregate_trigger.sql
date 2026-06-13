-- Stage 9 — keep courses.rating_avg_cached + rating_count_cached fresh
-- whenever a course_reviews row is inserted, updated (e.g. status flipped
-- to 'hidden'), or deleted.
--
-- Counts only status='published' rows. Hidden/legacy rows are excluded so
-- moderators hiding abusive reviews instantly drops them from the public
-- average.

create or replace function public.recompute_course_review_aggregates(p_course_id uuid)
returns void
language sql
as $$
  update public.courses
  set
    rating_avg_cached = (
      select round(avg(stars)::numeric, 2)
      from public.course_reviews
      where course_id = p_course_id and status = 'published'
    ),
    rating_count_cached = (
      select count(*)
      from public.course_reviews
      where course_id = p_course_id and status = 'published'
    )
  where id = p_course_id;
$$;

create or replace function public.tr_course_reviews_aggregate()
returns trigger
language plpgsql
as $$
begin
  -- INSERT / UPDATE: refresh aggregates for the affected course.
  -- DELETE: refresh for the (now-orphaned) old course_id.
  if tg_op = 'DELETE' then
    perform public.recompute_course_review_aggregates(old.course_id);
    return old;
  end if;

  perform public.recompute_course_review_aggregates(new.course_id);

  -- If course_id changed (rare — virtually never happens), also refresh old.
  if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
    perform public.recompute_course_review_aggregates(old.course_id);
  end if;

  return new;
end;
$$;

drop trigger if exists course_reviews_aggregate_trigger on public.course_reviews;

create trigger course_reviews_aggregate_trigger
after insert or update or delete on public.course_reviews
for each row execute function public.tr_course_reviews_aggregate();

-- Backfill any existing rows just in case.
do $$
declare
  c record;
begin
  for c in select distinct course_id from public.course_reviews loop
    perform public.recompute_course_review_aggregates(c.course_id);
  end loop;
end $$;
