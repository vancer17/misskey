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
import { ChannelMutingService } from '@/core/ChannelMutingService.js';
import { DI } from '@/di-symbols.js';

/**
 * ファイル領域：チャンネル集約タイムライン系 API（channels/global-timeline、ADR-0005 D3）
 *
 * 作用：自インスタンスの全アーカイブ済みでないチャンネルのノートを、ID 降順の
 * 単一ページネーションとして返却する（X Communities の Explore 相当）。
 * ログイン時はミュート済みチャンネル（へのリノート含む）を除外する。
 * LTL/GTL とは逆にチャンネルノートのみを返す点が本質（channelId IS NOT NULL）。
 */
export const meta = {
	tags: ['notes', 'channels'],

	requireCredential: false,

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
		private channelMutingService: ChannelMutingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.andWhere('note.channelId IS NOT NULL')
				// アーカイブ済みチャンネルは Explore の対象外（featured と同一条件）
				.innerJoinAndSelect('note.channel', 'channel', 'channel.isArchived = false')
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			this.queryService.generateBaseNoteFilteringQuery(query, me);

			if (me != null) {
				const mutingChannelIds = await this.channelMutingService
					.list({ requestUserId: me.id }, { idOnly: true })
					.then(x => x.map(x => x.id));
				if (mutingChannelIds.length > 0) {
					query.andWhere('note.channelId NOT IN (:...mutingChannelIds)', { mutingChannelIds });
					query.andWhere(new Brackets(qb => {
						qb.orWhere('note.renoteChannelId IS NULL');
						qb.orWhere('note.renoteChannelId NOT IN (:...mutingChannelIds)', { mutingChannelIds });
					}));
				}
			}

			return await this.noteEntityService.packMany(await query.limit(ps.limit).getMany(), me);
		});
	}
}
