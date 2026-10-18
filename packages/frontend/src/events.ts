/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 文件领域：前端既有事件入口；作用：传递确认信号，不保存业务状态或运维探测。 */
import { EventEmitter } from 'eventemitter3';
import * as Misskey from 'misskey-js';
import { onBeforeUnmount } from 'vue';

/** 已确认业务写入的跨组件通知；载荷只定位消费者，不定义业务规则。 */
type Events = {
	/** 用户置顶集合写入成功。 */
	userPinnedNotesChanged: (userId: Misskey.entities.User['id']) => void;
	/** 当前账户收藏集合写入成功。 */
	noteFavoritesChanged: () => void;
	/** 指定 Clip 的帖子成员发生已确认变化。 */
	clipNotesChanged: (clipId: Misskey.entities.Clip['id']) => void;
	clientNotification: (notification: Misskey.entities.Notification) => void;
	notePosted: (note: Misskey.entities.Note) => void;
	noteDeleted: (noteId: Misskey.entities.Note['id']) => void;
	noteRemovedFromAntenna: (antennaId: Misskey.entities.Antenna['id'], noteId: Misskey.entities.Note['id']) => void;
	driveFileCreated: (file: Misskey.entities.DriveFile) => void;
	driveFilesUpdated: (files: Misskey.entities.DriveFile[]) => void;
	driveFilesDeleted: (files: Misskey.entities.DriveFile[]) => void;
	driveFoldersUpdated: (folders: Misskey.entities.DriveFolder[]) => void;
	driveFoldersDeleted: (folders: Misskey.entities.DriveFolder[]) => void;
};

export const globalEvents = new EventEmitter<Events>();

export function useGlobalEvent<T extends keyof Events>(
	event: T,
	callback: EventEmitter.EventListener<Events, T>,
): void {
	globalEvents.on(event, callback);
	onBeforeUnmount(() => {
		globalEvents.off(event, callback);
	});
}
