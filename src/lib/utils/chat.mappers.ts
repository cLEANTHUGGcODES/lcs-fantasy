import { GlobalChatRow, GlobalChatReactionRow } from "@/types/chat.types";
import {
	GlobalChatMessage,
	GlobalChatReaction,
} from "@/interfaces/chat.interfaces";

import { asObject, asNumber, asStringOrNull } from "@/lib/utils/parsing";
import { normalizeReactionEmoji } from "@/lib/validation/chat.validators";

export const toGlobalChatMessage = (row: GlobalChatRow): GlobalChatMessage => ({
	id: row.id,
	userId: row.user_id,
	senderLabel: row.sender_label,
	senderAvatarUrl: row.sender_avatar_url,
	senderAvatarBorderColor: row.sender_avatar_border_color,
	message: row.message,
	imageUrl: row.image_url,
	reactions: [],
	createdAt: row.created_at,
});

export const toRpcGlobalChatMessage = (
	value: unknown,
): GlobalChatMessage | null => {
	const payload = asObject(value);
	if (!payload) {
		return null;
	}

	const id = asNumber(payload.id);
	const userId = asStringOrNull(payload.user_id);
	const senderLabel = asStringOrNull(payload.sender_label);
	const message = asStringOrNull(payload.message);
	const imageUrl = asStringOrNull(payload.image_url);
	const createdAt = asStringOrNull(payload.created_at);
	if (
		!id ||
		!userId ||
		!senderLabel ||
		message === null ||
		(!message.trim() && !imageUrl) ||
		!createdAt
	) {
		return null;
	}

	return {
		id,
		userId,
		senderLabel,
		senderAvatarUrl: asStringOrNull(payload.sender_avatar_url),
		senderAvatarBorderColor: asStringOrNull(payload.sender_avatar_border_color),
		message,
		imageUrl,
		reactions: [],
		createdAt,
	};
};

export const aggregateReactions = (
	rows: GlobalChatReactionRow[],
): GlobalChatReaction[] => {
	const byEmoji = new Map<string, GlobalChatReaction["users"]>();
	for (const row of rows) {
		const emoji = normalizeReactionEmoji(row.emoji);
		if (!emoji) {
			continue;
		}
		const label = row.reactor_label.trim();
		if (!label) {
			continue;
		}
		const users = byEmoji.get(emoji) ?? [];
		const alreadyIncluded = users.some((entry) => entry.userId === row.user_id);
		if (!alreadyIncluded) {
			users.push({
				userId: row.user_id,
				label,
			});
		}
		byEmoji.set(emoji, users);
	}

	return [...byEmoji.entries()].map(([emoji, users]) => ({
		emoji,
		users,
	}));
};

export const toReactionMapByMessageId = (
	rows: GlobalChatReactionRow[],
): Map<number, GlobalChatReaction[]> => {
	const rowsByMessageId = new Map<number, GlobalChatReactionRow[]>();
	for (const row of rows) {
		const bucket = rowsByMessageId.get(row.message_id) ?? [];
		bucket.push(row);
		rowsByMessageId.set(row.message_id, bucket);
	}
	const reactionsByMessageId = new Map<number, GlobalChatReaction[]>();
	for (const [messageId, messageRows] of rowsByMessageId.entries()) {
		reactionsByMessageId.set(messageId, aggregateReactions(messageRows));
	}
	return reactionsByMessageId;
};

export const attachReactionsToMessages = (
	messages: GlobalChatMessage[],
	reactionsByMessageId: Map<number, GlobalChatReaction[]>,
): GlobalChatMessage[] =>
	messages.map((entry) => ({
		...entry,
		reactions: reactionsByMessageId.get(entry.id) ?? [],
	}));
