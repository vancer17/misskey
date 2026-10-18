/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { NotesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ChannelFollowingService } from '@/core/ChannelFollowingService.js';
import { ChannelMutingService } from '@/core/ChannelMutingService.js';
import { DI } from '@/di-symbols.js';

/**
 * ファイル領域：チャンネル集約タイムライン系 API（channels/followed-timeline、ADR-0005 D2）
 *
 * 作用：ログインユーザーがフォローしているチャンネル群のノートを、ID 降順の
 * 単一ページネーションとして集約返却する（X Communities の Home 相当）。
 * ミュート済みチャンネルはフォロー集合から除外し、ミュート済みチャンネルへの
 * リノートも抑止する。クライアント側で複数チャンネルをマージするとページネー
 * ションの正確性が保てないため、サーバー集約として提供する。
 */
export const meta = {
	tags: ['notes', 'channels'],

	requireCredential: true,

	kind: 'read:channels',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private channelFollowingService: ChannelFollowingService,
		private channelMutingService: ChannelMutingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// ミュート済みチャンネルをフォロー集合から先に除外する（HTL と同一の方針）
			const mutingChannelIds = await this.channelMutingService
				.list({ requestUserId: me.id }, { idOnly: true })
				.then(x => x.map(x => x.id));
			const followingChannelIds = await this.channelFollowingService
				.list({ requestUserId: me.id }, { idOnly: true })
				.then(x => x.map(x => x.id).filter(x => !mutingChannelIds.includes(x)));

			if (followingChannelIds.length === 0) {
				return [];
			}

			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.andWhere('note.channelId IN (:...followingChannelIds)', { followingChannelIds })
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser')
				.leftJoinAndSelect('note.channel', 'channel');

			this.queryService.generateBaseNoteFilteringQuery(query, me);

			// フォロー内チャンネルへの投稿でも、ミュート済みチャンネルのノートへの
			// リノートは表示しない（channels/timeline と同一の方針）
			if (mutingChannelIds.length > 0) {
				query.andWhere(new Brackets(qb => {
					qb.orWhere('note.renoteChannelId IS NULL');
					qb.orWhere('note.renoteChannelId NOT IN (:...mutingChannelIds)', { mutingChannelIds });
				}));
			}

			return await this.noteEntityService.packMany(await query.limit(ps.limit).getMany(), me);
		});
	}
}
