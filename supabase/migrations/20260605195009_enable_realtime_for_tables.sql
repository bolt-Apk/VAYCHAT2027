/*
  # Enable realtime for messages and conversations
  
  Add tables to the supabase_realtime publication so that
  real-time subscriptions actually receive change events.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
