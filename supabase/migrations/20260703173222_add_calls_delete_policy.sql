-- Add missing DELETE policy for calls table so users can delete their call history
CREATE POLICY "Users can delete own calls"
  ON calls FOR DELETE
  TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id);
