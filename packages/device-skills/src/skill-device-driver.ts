// @file: device-skills/src/skill-device-driver.ts
// Skill 设备驱动器——将 SkillService 暴露为 VFS 设备。

import type {
    IDeviceDriver,
    DeviceContext,
    SkillDefinition,
    SkillLoadResult,
    IToolService,
} from '@itookit/common';
import { SkillService } from './skill-service';

/**
 * ioctl 命令常量
 */
export const SKILL_IOCTL = {
    /** 列出所有 Skill */
    LIST: 'skill:list',
    /** 获取指定 Skill */
    GET: 'skill:get',
    /** 获取所有 Skill 名称 */
    GET_NAMES: 'skill:getNames',
    /** 加载 Skill */
    LOAD: 'skill:load',
    /** 卸载 Skill */
    UNLOAD: 'skill:unload',
    /** 获取已加载的 Skill */
    GET_LOADED: 'skill:getLoaded',
    /** 获取未加载的 Skill */
    GET_UNLOADED: 'skill:getUnloaded',
    /** 自动检测 Skill */
    AUTO_DETECT: 'skill:autoDetect',
    /** 保存 Skill */
    SAVE: 'skill:save',
    /** 删除 Skill */
    DELETE: 'skill:delete',
} as const;

/**
 * Skill 设备驱动器。
 *
 * 注册方式：
 *   deviceManager.register('skills', new SkillDeviceDriver(toolService));
 *
 * 使用方式：
 *   const handle = createDeviceHandle(driver, ctx);
 *   const result = await handle.ioctl('skill:load', { id: 'docker' });
 */
export class SkillDeviceDriver implements IDeviceDriver {
    readonly type = 'skills';

    private service: SkillService;

    constructor(toolService: IToolService) {
        this.service = new SkillService(toolService);
    }

    async open(_ctx: DeviceContext, _options?: any): Promise<string> {
        return 'skills-default';
    }

    async close(_ctx: DeviceContext): Promise<void> {
        // 卸载所有已加载的 Skill
        for (const skill of this.service.getLoadedSkills()) {
            await this.service.unloadSkill(skill.id);
        }
    }

    async ioctl(ctx: DeviceContext, command: string, params?: any): Promise<any> {
        switch (command) {
            case SKILL_IOCTL.LIST:
                return this.service.listSkills();

            case SKILL_IOCTL.GET:
                return this.service.getSkill(params?.id);

            case SKILL_IOCTL.GET_NAMES:
                return this.service.getSkillNames();

            case SKILL_IOCTL.LOAD:
                return this.service.loadSkill(params?.id);

            case SKILL_IOCTL.UNLOAD:
                await this.service.unloadSkill(params?.id);
                return { success: true };

            case SKILL_IOCTL.GET_LOADED:
                return this.service.getLoadedSkills();

            case SKILL_IOCTL.GET_UNLOADED:
                return this.service.getUnloadedSkills();

            case SKILL_IOCTL.AUTO_DETECT:
                return this.service.autoDetectSkills(params?.prompt ?? '');

            case SKILL_IOCTL.SAVE:
                await this.service.saveSkill(params as SkillDefinition);
                return { success: true };

            case SKILL_IOCTL.DELETE:
                await this.service.deleteSkill(params?.id);
                return { success: true };

            default:
                throw new Error(`[SkillDeviceDriver] Unknown ioctl command: ${command}`);
        }
    }

    /**
     * 获取内部 SkillService 实例
     */
    getService(): SkillService {
        return this.service;
    }
}
