CREATE TABLE public.departments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  handles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.departments TO anon;
GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Departments are publicly readable" ON public.departments FOR SELECT USING (true);

INSERT INTO public.departments (name, slug, contact_email, handles) VALUES
  ('Roads & Infrastructure', 'roads', 'roads@city.gov', ARRAY['pothole']),
  ('Sanitation', 'sanitation', 'sanitation@city.gov', ARRAY['garbage']),
  ('Water Works', 'water', 'water@city.gov', ARRAY['water_leak']),
  ('General Grievance Cell', 'general', 'grievance@city.gov', ARRAY['other']);

CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  image_path TEXT NOT NULL,
  image_hash TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  geo_cell TEXT,
  citizen_note TEXT,
  category TEXT,
  confidence NUMERIC(4,3),
  severity_score INTEGER,
  priority TEXT,
  department_id UUID REFERENCES public.departments(id),
  ai_description TEXT,
  recommended_action TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_error TEXT,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'reported',
  confirmations INTEGER NOT NULL DEFAULT 1,
  captured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_user_idx ON public.reports (user_id, created_at DESC);
CREATE INDEX reports_geo_cell_idx ON public.reports (geo_cell, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Citizens read own reports" ON public.reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Citizens create own reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Citizens update own reports" ON public.reports FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Citizens delete own reports" ON public.reports FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.report_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX report_events_report_idx ON public.report_events (report_id, created_at);

GRANT SELECT, INSERT ON public.report_events TO authenticated;
GRANT ALL ON public.report_events TO service_role;
ALTER TABLE public.report_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read events of own reports" ON public.report_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id AND r.user_id = auth.uid()));
CREATE POLICY "Insert events on own reports" ON public.report_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id AND r.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users upload own report photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'report-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users read own report photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'report-photos' AND (storage.foldername(name))[1] = auth.uid()::text);