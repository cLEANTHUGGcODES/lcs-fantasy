export interface GlobalChatMessage {
  id: number;
  userId: string;
  senderLabel: string;
  senderAvatarUrl: string | null;
  senderAvatarBorderColor: string | null;
  message: string;
  imageUrl: string | null;
  createdAt: string;
}
