/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 群聊实体协议：公开只读成员事实，避免界面从邀请或审核权限猜测成员身份。 */

/** 群聊只读实体的权威响应 Schema。 */
export const packedChatRoomSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		createdAt: {
			type: 'string',
			format: 'date-time',
			optional: false, nullable: false,
		},
		ownerId: {
			type: 'string',
			optional: false, nullable: false,
		},
		owner: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		description: {
			type: 'string',
			optional: false, nullable: false,
		},
		/** 当前请求账号是否为群主或正式成员。 */
		isMember: { type: 'boolean', optional: true, nullable: false },
		isMuted: {
			type: 'boolean',
			optional: true, nullable: false,
		},
		invitationExists: {
			type: 'boolean',
			optional: true, nullable: false,
		},
	},
} as const;
