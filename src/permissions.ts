import type { Permission, Role } from "./model";
export interface PermissionModule {
  key: string;
  label: string;
  description: string;
  actions: { key: Permission; label: string; description: string }[];
}
export const permissionModules: PermissionModule[] = [
  {
    key: "workbench",
    label: "工作台",
    description: "查看待办事项与近期发布安排",
    actions: [],
  },
  {
    key: "library",
    label: "内容库",
    description: "查看文件、版本、材料标签与页级标签",
    actions: [
      {
        key: "upload",
        label: "上传内容",
        description: "上传文件、添加公开链接和创建新版本",
      },
      {
        key: "edit",
        label: "编辑内容与审批",
        description: "修改内容信息，登记或更换审批信息，重试解析",
      },
      {
        key: "tags",
        label: "维护内容标签",
        description: "添加、移除材料及页级标签，采纳已入库推荐，重试失败页打标",
      },
      { key: "void", label: "作废内容", description: "作废内容并填写原因" },
      {
        key: "export",
        label: "下载与导出",
        description: "下载原文件、导出所选内容",
      },
      {
        key: "exempt",
        label: "免登记审批",
        description: "上传或编辑内容时选择无需登记审批",
      },
      {
        key: "evidence",
        label: "查看与下载审批截图",
        description: "查看审批原图，下载截图；导出含截图文件还需下载与导出权限",
      },
    ],
  },
  {
    key: "publishing",
    label: "发布管理",
    description: "查看发布记录、拟发布时间、状态与发布预览",
    actions: [
      {
        key: "publish",
        label: "创建与提交发布",
        description: "选择内容、编辑发布草稿、提交发布；不包含内容和审批编辑",
      },
    ],
  },
  {
    key: "collection",
    label: "公众号采集",
    description: "查看公众号文章与采集结果",
    actions: [],
  },
  {
    key: "tags",
    label: "标签管理",
    description: "查看标签库、全部推荐标签及其来源",
    actions: [
      {
        key: "taxonomy",
        label: "维护标签库与推荐",
        description:
          "新增、编辑、启停标签，忽略推荐；采纳到内容还需维护内容标签权限",
      },
    ],
  },
  {
    key: "admin",
    label: "系统管理",
    description: "管理账号和角色",
    actions: [
      {
        key: "admin",
        label: "管理账号与角色",
        description: "创建和维护账号、角色，配置菜单与操作权限",
      },
    ],
  },
];
export function moduleForPermission(permission: Permission) {
  return permissionModules.find((module) =>
    module.actions.some((a) => a.key === permission),
  );
}
export function toggleRoleModule(
  role: Role,
  key: string,
  checked: boolean,
): Role {
  const module = permissionModules.find((m) => m.key === key);
  if (!module) return role;
  return {
    ...role,
    menus: checked
      ? [...new Set([...role.menus, key])]
      : role.menus.filter((m) => m !== key),
    permissions: checked
      ? key === "admin"
        ? [...new Set([...role.permissions, "admin" as Permission])]
        : role.permissions
      : role.permissions.filter(
          (p) => !module.actions.some((a) => a.key === p),
        ),
  };
}
export function toggleRoleAction(
  role: Role,
  permission: Permission,
  checked: boolean,
): Role {
  const module = moduleForPermission(permission);
  if (!module) return role;
  const next = checked ? toggleRoleModule(role, module.key, true) : role;
  return {
    ...next,
    menus:
      !checked && permission === "admin"
        ? next.menus.filter((m) => m !== "admin")
        : next.menus,
    permissions: checked
      ? [...new Set([...next.permissions, permission])]
      : next.permissions.filter((p) => p !== permission),
  };
}
