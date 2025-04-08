import type {
    ChatInputCommandInteraction,
    GuildMemberRoleManager,
    PermissionResolvable,
} from "discord.js";

class GlobalPermissionChecker {
    protected readonly commandManagerUserIds: string[];
    protected readonly permissions: PermissionResolvable[];
    protected readonly allowedRoles: string[];

    constructor({
        commandManagerUserIds,
        permissions,
        allowedRoles,
    }: {
        commandManagerUserIds: string[];
        permissions: PermissionResolvable[];
        allowedRoles: string[];
    }) {
        this.commandManagerUserIds = commandManagerUserIds;
        this.permissions = permissions;
        this.allowedRoles = allowedRoles;
    }

    protected hasValidRole(interaction: ChatInputCommandInteraction): boolean {
        const member = interaction.member;
        if (!member || !("roles" in member)) return false;

        const roles = member.roles as GuildMemberRoleManager;
        const hasRole = this.allowedRoles.some((roleId) =>
            roles.cache.has(roleId)
        );

        return hasRole;
    }

    protected hasValidPermission(
        interaction: ChatInputCommandInteraction
    ): boolean {
        return this.permissions.every((permission) =>
            interaction.memberPermissions?.has(permission)
        );
    }

    protected isCommandManagerUser(
        interaction: ChatInputCommandInteraction
    ): boolean {
        if (interaction.user.id === interaction.guild?.ownerId) return true;
        return this.commandManagerUserIds.includes(interaction.user.id);
    }

    public checkPermissions(interaction: ChatInputCommandInteraction): boolean {
        const member = interaction.member;
        if (!member) return false;

        const isCommandManagerUser = this.isCommandManagerUser(interaction);
        const hasPermission = this.hasValidPermission(interaction);
        const hasRole = this.hasValidRole(interaction);

        return hasPermission || hasRole || isCommandManagerUser;
    }

    public getCommandManagerUserIds(): string[] {
        return this.commandManagerUserIds;
    }

    public getPermissions(): PermissionResolvable[] {
        return this.permissions;
    }

    public getAllowedRoles(): string[] {
        return this.allowedRoles;
    }
}

class PermissionChecker extends GlobalPermissionChecker {
    constructor(
        globalPermissions: GlobalPermissionChecker,
        localPermissions?: {
            commandManagerUserIds?: string[];
            permissions?: PermissionResolvable[];
            allowedRoles?: string[];
        }
    ) {
        super({
            commandManagerUserIds: [
                ...globalPermissions.getCommandManagerUserIds(),
                ...(localPermissions?.commandManagerUserIds ?? []),
            ],
            permissions: [
                ...globalPermissions.getPermissions(),
                ...(localPermissions?.permissions ?? []),
            ],
            allowedRoles: [
                ...globalPermissions.getAllowedRoles(),
                ...(localPermissions?.allowedRoles ?? []),
            ],
        });
    }
}

export { GlobalPermissionChecker, PermissionChecker };
