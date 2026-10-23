/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：成就目录与徽章展示资产。
 * 作用：集中既有成就标识、排列顺序及徽章，供存量申领工具和新业务模块共享。
 * 数据链：唯一目录 → 名称类型／只读资产 → 协议适配与展示；不包含查询或账户状态。
 */
/** 成就目录的唯一标识与既有展示顺序；所有消费者从本目录派生名称。 */
export const ACHIEVEMENT_TYPES = [
	/** 初来乍到：目录中的成就标识。 */
	'notes1',
	/** 一些帖子：目录中的成就标识。 */
	'notes10',
	/** 很多帖子：目录中的成就标识。 */
	'notes100',
	/** 满是帖子：目录中的成就标识。 */
	'notes500',
	/** 积帖成山：目录中的成就标识。 */
	'notes1000',
	/** 帖如泉涌：目录中的成就标识。 */
	'notes5000',
	/** 超级帖：目录中的成就标识。 */
	'notes10000',
	/** 还想要更多帖子：目录中的成就标识。 */
	'notes20000',
	/** 帖子帖子帖子：目录中的成就标识。 */
	'notes30000',
	/** 帖子工厂：目录中的成就标识。 */
	'notes40000',
	/** 帖子星球：目录中的成就标识。 */
	'notes50000',
	/** 帖子类星体：目录中的成就标识。 */
	'notes60000',
	/** 帖子黑洞：目录中的成就标识。 */
	'notes70000',
	/** 帖子星系：目录中的成就标识。 */
	'notes80000',
	/** 帖子起源：目录中的成就标识。 */
	'notes90000',
	/** ALL YOUR NOTE ARE BELONG TO US：目录中的成就标识。 */
	'notes100000',
	/** 初学者 I：目录中的成就标识。 */
	'login3',
	/** 初学者 II：目录中的成就标识。 */
	'login7',
	/** 初学者 III：目录中的成就标识。 */
	'login15',
	/** Misskist Ⅰ：目录中的成就标识。 */
	'login30',
	/** Misskist Ⅱ：目录中的成就标识。 */
	'login60',
	/** Misskist Ⅲ：目录中的成就标识。 */
	'login100',
	/** 定期联系Ⅰ：目录中的成就标识。 */
	'login200',
	/** 定期联系Ⅱ：目录中的成就标识。 */
	'login300',
	/** 定期联系Ⅲ：目录中的成就标识。 */
	'login400',
	/** 老熟人Ⅰ：目录中的成就标识。 */
	'login500',
	/** 老熟人Ⅱ：目录中的成就标识。 */
	'login600',
	/** 老熟人Ⅲ：目录中的成就标识。 */
	'login700',
	/** 帖子大师 Ⅰ：目录中的成就标识。 */
	'login800',
	/** 帖子大师 Ⅱ：目录中的成就标识。 */
	'login900',
	/** 帖子大师 Ⅲ：目录中的成就标识。 */
	'login1000',
	/** 一周年：目录中的成就标识。 */
	'passedSinceAccountCreated1',
	/** 二周年：目录中的成就标识。 */
	'passedSinceAccountCreated2',
	/** 三周年：目录中的成就标识。 */
	'passedSinceAccountCreated3',
	/** 生日快乐：目录中的成就标识。 */
	'loggedInOnBirthday',
	/** 恭贺新禧：目录中的成就标识。 */
	'loggedInOnNewYearsDay',
	/** 忍不住想加入便签：目录中的成就标识。 */
	'noteClipped1',
	/** 观星者：目录中的成就标识。 */
	'noteFavorited1',
	/** 想要星星：目录中的成就标识。 */
	'myNoteFavorited1',
	/** 整装待发：目录中的成就标识。 */
	'profileFilled',
	/** 我是猫：目录中的成就标识。 */
	'markedAsCat',
	/** 首次关注：目录中的成就标识。 */
	'following1',
	/** 关注，跟随：目录中的成就标识。 */
	'following10',
	/** 我的朋友很多：目录中的成就标识。 */
	'following50',
	/** 胜友如云：目录中的成就标识。 */
	'following100',
	/** 朋友成群：目录中的成就标识。 */
	'following300',
	/** 最初的关注者：目录中的成就标识。 */
	'followers1',
	/** 关注我吧！：目录中的成就标识。 */
	'followers10',
	/** 三五成群：目录中的成就标识。 */
	'followers50',
	/** 胜友如云：目录中的成就标识。 */
	'followers100',
	/** 排列成行：目录中的成就标识。 */
	'followers300',
	/** 信号塔：目录中的成就标识。 */
	'followers500',
	/** 大影响家：目录中的成就标识。 */
	'followers1000',
	/** 成就收藏家：目录中的成就标识。 */
	'collectAchievements30',
	/** 成就爱好者：目录中的成就标识。 */
	'viewAchievements3min',
	/** I Love Misskey：目录中的成就标识。 */
	'iLoveMisskey',
	/** 寻宝：目录中的成就标识。 */
	'foundTreasure',
	/** 休息一下！：目录中的成就标识。 */
	'client30min',
	/** Misskey 重度依赖：目录中的成就标识。 */
	'client60min',
	/** 欲言又止：目录中的成就标识。 */
	'noteDeletedWithin1min',
	/** 夜猫子：目录中的成就标识。 */
	'postedAtLateNight',
	/** 报时：目录中的成就标识。 */
	'postedAt0min0sec',
	/** 自我引用：目录中的成就标识。 */
	'selfQuote',
	/** 流动的时间线：目录中的成就标识。 */
	'htl20npm',
	/** 分析师：目录中的成就标识。 */
	'viewInstanceChart',
	/** Hello, world!：目录中的成就标识。 */
	'outputHelloWorldOnScratchpad',
	/** 多窗口：目录中的成就标识。 */
	'open3windows',
	/** 循环引用：目录中的成就标识。 */
	'driveFolderCircularReference',
	/** 有好好读过吗？：目录中的成就标识。 */
	'reactWithoutRead',
	/** 点这里：目录中的成就标识。 */
	'clickedClickHere',
	/** 超高校级的幸运：目录中的成就标识。 */
	'justPlainLucky',
	/** 上帝情结：目录中的成就标识。 */
	'setNameToSyuilo',
	/** 饼干点点乐：目录中的成就标识。 */
	'cookieClicked',
	/** Brain Diver：目录中的成就标识。 */
	'brainDiver',
	/** 过度测试：目录中的成就标识。 */
	'smashTestNotificationButton',
	/** Misskey 初学者课程 结业证书：目录中的成就标识。 */
	'tutorialCompleted',
	/** 🤯：目录中的成就标识。 */
	'bubbleGameExplodingHead',
	/** 两个🤯：目录中的成就标识。 */
	'bubbleGameDoubleExplodingHead',
] as const;

/** 业务成就名称只从唯一目录派生，不另建枚举。 */
export type AchievementName = typeof ACHIEVEMENT_TYPES[number];

/** 徽章是目录关联的既有展示资产，不参与成就解锁判断。 */
export type AchievementBadge = Readonly<{
	img: string;
	bg: string | null;
	frame: 'bronze' | 'silver' | 'gold' | 'platinum';
}>;

/** 唯一徽章资产表；迁移保留原图片、渐变和等级，不复制配置。 */
export const ACHIEVEMENT_BADGES: Readonly<Record<AchievementName, AchievementBadge>> = {
	/** 初来乍到：沿用原徽章资产。 */
	'notes1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4dd.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 一些帖子：沿用原徽章资产。 */
	'notes10': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4d1.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 很多帖子：沿用原徽章资产。 */
	'notes100': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4d2.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 满是帖子：沿用原徽章资产。 */
	'notes500': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4da.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 积帖成山：沿用原徽章资产。 */
	'notes1000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f5c3.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 帖如泉涌：沿用原徽章资产。 */
	'notes5000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f304.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 超级帖：沿用原徽章资产。 */
	'notes10000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f3d9.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 还想要更多帖子：沿用原徽章资产。 */
	'notes20000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f307.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 帖子帖子帖子：沿用原徽章资产。 */
	'notes30000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f306.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 帖子工厂：沿用原徽章资产。 */
	'notes40000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f303.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 帖子星球：沿用原徽章资产。 */
	'notes50000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1fa90.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子类星体：沿用原徽章资产。 */
	'notes60000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/2604.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子黑洞：沿用原徽章资产。 */
	'notes70000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f30c.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子星系：沿用原徽章资产。 */
	'notes80000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f30c.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子起源：沿用原徽章资产。 */
	'notes90000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f30c.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 232 119), rgb(255 140 41))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** ALL YOUR NOTE ARE BELONG TO US：沿用原徽章资产。 */
	'notes100000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/267e.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 232 119), rgb(255 140 41))',
		/** 原徽章边框等级。 */
		frame: 'platinum',
	},
	/** 初学者 I：沿用原徽章资产。 */
	'login3': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f331.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 初学者 II：沿用原徽章资产。 */
	'login7': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f331.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 初学者 III：沿用原徽章资产。 */
	'login15': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f331.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144, 224, 255), rgb(255, 168, 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Misskist Ⅰ：沿用原徽章资产。 */
	'login30': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1fab4.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Misskist Ⅱ：沿用原徽章资产。 */
	'login60': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1fab4.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Misskist Ⅲ：沿用原徽章资产。 */
	'login100': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1fab4.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144, 224, 255), rgb(255, 168, 252))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 定期联系Ⅰ：沿用原徽章资产。 */
	'login200': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f333.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 定期联系Ⅱ：沿用原徽章资产。 */
	'login300': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f333.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 定期联系Ⅲ：沿用原徽章资产。 */
	'login400': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f333.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144, 224, 255), rgb(255, 168, 252))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 老熟人Ⅰ：沿用原徽章资产。 */
	'login500': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f304.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 老熟人Ⅱ：沿用原徽章资产。 */
	'login600': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f304.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 老熟人Ⅲ：沿用原徽章资产。 */
	'login700': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f304.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144, 224, 255), rgb(255, 168, 252))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子大师 Ⅰ：沿用原徽章资产。 */
	'login800': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f307.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子大师 Ⅱ：沿用原徽章资产。 */
	'login900': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f307.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 帖子大师 Ⅲ：沿用原徽章资产。 */
	'login1000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f307.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144, 224, 255), rgb(255, 168, 252))',
		/** 原徽章边框等级。 */
		frame: 'platinum',
	},
	/** 忍不住想加入便签：沿用原徽章资产。 */
	'noteClipped1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f587.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 观星者：沿用原徽章资产。 */
	'noteFavorited1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f31f.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 想要星星：沿用原徽章资产。 */
	'myNoteFavorited1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f320.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 整装待发：沿用原徽章资产。 */
	'profileFilled': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f44c.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 我是猫：沿用原徽章资产。 */
	'markedAsCat': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f408.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 首次关注：沿用原徽章资产。 */
	'following1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/2618.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 关注，跟随：沿用原徽章资产。 */
	'following10': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f6b8.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 我的朋友很多：沿用原徽章资产。 */
	'following50': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f91d.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 胜友如云：沿用原徽章资产。 */
	'following100': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4af.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 53 184), rgb(255 206 69))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 朋友成群：沿用原徽章资产。 */
	'following300': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f970.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 最初的关注者：沿用原徽章资产。 */
	'followers1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/2618.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 关注我吧！：沿用原徽章资产。 */
	'followers10': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f44b.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(59 187 116), rgb(199 211 102))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 三五成群：沿用原徽章资产。 */
	'followers50': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f411.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 胜友如云：沿用原徽章资产。 */
	'followers100': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f60e.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 排列成行：沿用原徽章资产。 */
	'followers300': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f3c6.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 信号塔：沿用原徽章资产。 */
	'followers500': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4e1.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 大影响家：沿用原徽章资产。 */
	'followers1000': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f451.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 232 119), rgb(255 140 41))',
		/** 原徽章边框等级。 */
		frame: 'platinum',
	},
	/** 成就收藏家：沿用原徽章资产。 */
	'collectAchievements30': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f3c5.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 成就爱好者：沿用原徽章资产。 */
	'viewAchievements3min': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f3c5.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** I Love Misskey：沿用原徽章资产。 */
	'iLoveMisskey': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/2764.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 寻宝：沿用原徽章资产。 */
	'foundTreasure': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f3c6.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 休息一下！：沿用原徽章资产。 */
	'client30min': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f552.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Misskey 重度依赖：沿用原徽章资产。 */
	'client60min': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f552.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 欲言又止：沿用原徽章资产。 */
	'noteDeletedWithin1min': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f5d1.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 夜猫子：沿用原徽章资产。 */
	'postedAtLateNight': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f319.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(197 69 192), rgb(2 112 155))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 报时：沿用原徽章资产。 */
	'postedAt0min0sec': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f55b.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(58 231 198), rgb(37 194 255))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 自我引用：沿用原徽章资产。 */
	'selfQuote': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4dd.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 流动的时间线：沿用原徽章资产。 */
	'htl20npm': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f30a.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 分析师：沿用原徽章资产。 */
	'viewInstanceChart': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4ca.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(58 231 198), rgb(37 194 255))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Hello, world!：沿用原徽章资产。 */
	'outputHelloWorldOnScratchpad': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f530.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(58 231 198), rgb(37 194 255))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 多窗口：沿用原徽章资产。 */
	'open3windows': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f5a5.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 循环引用：沿用原徽章资产。 */
	'driveFolderCircularReference': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f4c2.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 有好好读过吗？：沿用原徽章资产。 */
	'reactWithoutRead': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/2753.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 点这里：沿用原徽章资产。 */
	'clickedClickHere': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/2757.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144 224 255), rgb(255 168 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 超高校级的幸运：沿用原徽章资产。 */
	'justPlainLucky': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f340.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 上帝情结：沿用原徽章资产。 */
	'setNameToSyuilo': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f36e.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 一周年：沿用原徽章资产。 */
	'passedSinceAccountCreated1': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/31-20e3.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 二周年：沿用原徽章资产。 */
	'passedSinceAccountCreated2': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/32-20e3.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 三周年：沿用原徽章资产。 */
	'passedSinceAccountCreated3': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/33-20e3.png',
		/** 原徽章内部背景。 */
		bg: null,
		/** 原徽章边框等级。 */
		frame: 'gold',
	},
	/** 生日快乐：沿用原徽章资产。 */
	'loggedInOnBirthday': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f382.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 恭贺新禧：沿用原徽章资产。 */
	'loggedInOnNewYearsDay': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f38d.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 144 144), rgb(255 232 168))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
	/** 饼干点点乐：沿用原徽章资产。 */
	'cookieClicked': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f36a.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Brain Diver：沿用原徽章资产。 */
	'brainDiver': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f9e0.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(144, 224, 255), rgb(255, 168, 252))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 过度测试：沿用原徽章资产。 */
	'smashTestNotificationButton': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f514.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(187 183 59), rgb(255 143 77))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** Misskey 初学者课程 结业证书：沿用原徽章资产。 */
	'tutorialCompleted': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f393.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(220 223 225), rgb(172 192 207))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 🤯：沿用原徽章资产。 */
	'bubbleGameExplodingHead': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f92f.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
		/** 原徽章边框等级。 */
		frame: 'bronze',
	},
	/** 两个🤯：沿用原徽章资产。 */
	'bubbleGameDoubleExplodingHead': {
		/** 原徽章图片路径。 */
		img: '/fluent-emoji/1f92f.png',
		/** 原徽章内部背景。 */
		bg: 'linear-gradient(0deg, rgb(255 77 77), rgb(247 155 214))',
		/** 原徽章边框等级。 */
		frame: 'silver',
	},
} as const;

/** 徽章边框的原有展示资产；与业务等级同源，颜色不参与解锁或排列。 */
export const ACHIEVEMENT_FRAME_STYLES: Readonly<Record<AchievementBadge['frame'], Readonly<{ frame: string; inner: string; shine: string | null }>>> = {
	/** 原铜色徽章边框。 */
	bronze: {
		/** 原铜色外框渐变。 */
		frame: 'linear-gradient(0deg, #703827, #d37566)',
		/** 原铜色内部渐变。 */
		inner: 'linear-gradient(0deg, #d37566, #703827)',
		/** 铜色无扫光。 */
		shine: null,
	},
	/** 原银色徽章边框。 */
	silver: {
		/** 原银色外框渐变。 */
		frame: 'linear-gradient(0deg, #7c7c7c, #e1e1e1)',
		/** 原银色内部渐变。 */
		inner: 'linear-gradient(0deg, #e1e1e1, #7c7c7c)',
		/** 银色无扫光。 */
		shine: null,
	},
	/** 原金色徽章边框。 */
	gold: {
		/** 原金色外框渐变。 */
		frame: 'linear-gradient(0deg, rgba(255,182,85,1) 0%, rgba(233,133,0,1) 49%, rgba(255,243,93,1) 51%, rgba(255,187,25,1) 100%)',
		/** 原金色内部渐变。 */
		inner: 'linear-gradient(0deg, #ffee20, #eb7018)',
		/** 原金色扫光。 */
		shine: '#ffffff88',
	},
	/** 原铂金色徽章边框。 */
	platinum: {
		/** 原铂金色外框渐变。 */
		frame: 'linear-gradient(0deg, rgba(154,154,154,1) 0%, rgba(226,226,226,1) 49%, rgba(255,255,255,1) 51%, rgba(195,195,195,1) 100%)',
		/** 原铂金色内部渐变。 */
		inner: 'linear-gradient(0deg, #e1e1e1, #7c7c7c)',
		/** 原铂金色扫光。 */
		shine: '#ffffffee',
	},
} as const;

/** 原徽章的固定光影资产；与原基础组件保持相同像素值。 */
export const ACHIEVEMENT_BADGE_EFFECTS: Readonly<{ frameShadow: string; innerShadow: string; imageShadow: string }> = {
	/** 外框投影。 */
	frameShadow: 'drop-shadow(0px 2px 2px #00000044)',
	/** 内侧高光。 */
	innerShadow: '0 1px 0px #ffffff88 inset',
	/** 图片投影。 */
	imageShadow: 'drop-shadow(0px 1px 2px #000000aa)',
} as const;
