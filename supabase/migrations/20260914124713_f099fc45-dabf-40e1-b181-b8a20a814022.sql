-- Roles
CREATE TYPE public.app_role AS ENUM ('citizen', 'staff', 'admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Staff access requests
CREATE TABLE public.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  department_id uuid NOT NULL REFERENCES public.departments(id),
  full_name text NOT NULL,
  work_email text NOT NULL,
  job_title text,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_profiles_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

GRANT SELECT, INSERT, UPDATE ON public.staff_profiles TO authenticated;
GRANT ALL ON public.staff_profiles TO service_role;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_staff_profiles_updated_at BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.current_staff_department()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.staff_profiles
  WHERE user_id = auth.uid() AND status = 'approved'
  LIMIT 1
$$;

CREATE POLICY "Staff read own request" ON public.staff_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Staff create own request" ON public.staff_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'pending');
CREATE POLICY "Admins read all requests" ON public.staff_profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins decide requests" ON public.staff_profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Audit trail photo
ALTER TABLE public.report_events ADD COLUMN photo_path text;

-- Staff/admin access to routed reports
CREATE POLICY "Staff read department reports" ON public.reports
  FOR SELECT TO authenticated
  USING (
    (department_id IS NOT NULL AND department_id = public.current_staff_department())
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "Staff update department reports" ON public.reports
  FOR UPDATE TO authenticated
  USING (
    (department_id IS NOT NULL AND department_id = public.current_staff_department())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    (department_id IS NOT NULL AND department_id = public.current_staff_department())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Staff read department report events" ON public.report_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_events.report_id
      AND ((r.department_id IS NOT NULL AND r.department_id = public.current_staff_department())
           OR public.has_role(auth.uid(), 'admin'))
  ));
CREATE POLICY "Staff add department report events" ON public.report_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_events.report_id
      AND ((r.department_id IS NOT NULL AND r.department_id = public.current_staff_department())
           OR public.has_role(auth.uid(), 'admin'))
  ));

-- Department notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, report_id)
);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX notifications_department_idx ON public.notifications (department_id, created_at DESC);

CREATE POLICY "Staff read own department notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (department_id = public.current_staff_department() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Staff mark own department notifications read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (department_id = public.current_staff_department() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (department_id = public.current_staff_department() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.notify_department_on_routing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.department_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.department_id IS DISTINCT FROM NEW.department_id) THEN
    INSERT INTO public.notifications (department_id, report_id, title, body)
    VALUES (
      NEW.department_id,
      NEW.id,
      'New ' || COALESCE(NEW.category, 'issue') || ' report' ||
        CASE WHEN NEW.priority IS NOT NULL THEN ' (' || NEW.priority || ' priority)' ELSE '' END,
      COALESCE(NEW.ai_description, NEW.citizen_note, 'A citizen submitted a new report.')
    )
    ON CONFLICT (department_id, report_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_department_after_insert AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_department_on_routing();
CREATE TRIGGER notify_department_after_update AFTER UPDATE OF department_id ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_department_on_routing();

-- One-time first-admin bootstrap
CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'admin')
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;

-- Resolution photos in the report-photos bucket
CREATE POLICY "Staff upload resolution photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'report-photos'
    AND (storage.foldername(name))[1] = 'resolutions'
    AND (public.current_staff_department() IS NOT NULL OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Staff read report photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-photos'
    AND (public.current_staff_department() IS NOT NULL OR public.has_role(auth.uid(), 'admin'))
  );
