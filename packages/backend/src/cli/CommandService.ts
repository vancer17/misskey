/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 后端维护命令领域：承接 CLI 调度并复用现有服务执行人工维护任务。
 * 帖子搜索回填只扫描数据库事实并提交索引，不修改帖子或搜索权限规则。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import { SearchService } from '@/core/SearchService.js';
import type { MiNote, NotesRepository } from '@/models/_.js';
import type { Meilisearch } from 'meilisearch';

/** 维护命令入口，保持命令编排与现有领域服务之间的单向调用。 */
@Injectable()
export class CommandService {
	private logger: Logger;

	/** 注入维护任务使用的配置、事实仓储及现有领域服务。 */
	constructor(
		@Inject(DI.config)
		private config: Config,

		private metaService: MetaService,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.meilisearch)
		private meilisearch: Meilisearch | null,

		private searchService: SearchService,
	) {
	}

	/**
	 * 在暂停帖子写入的维护期，按固定上界和有界 ID 游标幂等回填搜索索引。
	 * 索引资格与文档映射完全复用 SearchService；返回扫描量，不宣称异步索引已完成。
	 */
	@bindThis
	public async backfillNoteSearch(): Promise<number> {
		if (this.config.fulltextSearch?.provider !== 'meilisearch' || !this.meilisearch) {
			throw new Error('Note search backfill requires the configured Meilisearch provider.');
		}
		await this.meilisearch.health();

		const upperNote: MiNote | null = await this.notesRepository.findOne({
			where: {},
			order: { id: 'DESC' },
		});
		if (upperNote == null) return 0;

		const batchSize: number = 100;
		let cursor: MiNote['id'] | null = null;
		let scanned: number = 0;
		while (true) {
			const query: SelectQueryBuilder<MiNote> = this.notesRepository.createQueryBuilder('note')
				.where('note.id <= :upperId', { upperId: upperNote.id })
				.orderBy('note.id', 'ASC')
				.take(batchSize);
			if (cursor != null) query.andWhere('note.id > :cursor', { cursor });
			const notes: MiNote[] = await query.getMany();
			if (notes.length === 0) break;

			for (let index: number = 0; index < notes.length; index += 1) {
				const note: MiNote = notes[index];
				await this.searchService.indexNote(note);
				scanned += 1;
				cursor = note.id;
			}
		}
		return scanned;
	}

	@bindThis
	public async ping() {
		console.log('pong');
	}

	@bindThis
	public async resetCaptcha() {
		await this.metaService.update({
			enableHcaptcha: false,
			hcaptchaSiteKey: null,
			hcaptchaSecretKey: null,
			enableMcaptcha: false,
			mcaptchaSitekey: null,
			mcaptchaSecretKey: null,
			mcaptchaInstanceUrl: null,
			enableRecaptcha: false,
			recaptchaSiteKey: null,
			recaptchaSecretKey: null,
			enableTurnstile: false,
			turnstileSiteKey: null,
			turnstileSecretKey: null,
			enableTestcaptcha: false,
		});
	}
}
