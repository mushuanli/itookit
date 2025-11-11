/**
 * 依赖注入容器
 */
export class ServiceContainer {
  private services: Map<string | symbol, any> = new Map();

  /**
   * 注册服务
   */
  provide(key: string | symbol, service: any): void {
    this.services.set(key, service);
  }

  /**
   * 获取服务
   */
  inject(key: string | symbol): any {
    return this.services.get(key);
  }

  /**
   * 检查服务是否存在
   */
  has(key: string | symbol): boolean {
    return this.services.has(key);
  }

  /**
   * 移除服务
   */
  remove(key: string | symbol): void {
    this.services.delete(key);
  }

  /**
   * 清空所有服务
   */
  clear(): void {
    this.services.clear();
  }
}
