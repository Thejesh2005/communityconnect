CREATE POLICY "Citizens read resolution photos of own reports" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-photos'
    AND (storage.foldername(name))[1] = 'resolutions'
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.user_id = auth.uid()
        AND r.id::text = (storage.foldername(name))[2]
    )
  );
