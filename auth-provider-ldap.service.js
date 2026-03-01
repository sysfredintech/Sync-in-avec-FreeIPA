"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuthProviderLDAP", {
    enumerable: true,
    get: function() {
        return AuthProviderLDAP;
    }
});
const _common = require("@nestjs/common");
const _ldapts = require("ldapts");
const _appconstants = require("../../../app.constants");
const _user = require("../../../applications/users/constants/user");
const _adminusersmanagerservice = require("../../../applications/users/services/admin-users-manager.service");
const _usersmanagerservice = require("../../../applications/users/services/users-manager.service");
const _functions = require("../../../common/functions");
const _configenvironment = require("../../../configuration/config.environment");
const _authldapconstants = require("./auth-ldap.constants");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let AuthProviderLDAP = class AuthProviderLDAP {
    async validateUser(loginOrEmail, password, ip, scope) {
        // Authenticate user via LDAP and sync local user state.
        // Find user from his login or email
        let user = await this.usersManager.findUser(this.dbLogin(loginOrEmail), false);
        if (user) {
            if (user.isGuest || scope) {
                // Allow local password authentication for guest users and application scopes (app passwords)
                return this.usersManager.logUser(user, password, ip, scope);
            }
            if (!user.isActive) {
                this.logger.error({
                    tag: this.validateUser.name,
                    msg: `user *${user.login}* is locked`
                });
                throw new _common.HttpException('Account locked', _common.HttpStatus.FORBIDDEN);
            }
        }
        let ldapErrorMessage;
        let entry = false;
        try {
            // If a user was found, use the stored login. This allows logging in with an email.
            entry = await this.checkAuth(user?.login || loginOrEmail, password);
        } catch (e) {
            ldapErrorMessage = e.message;
        }
        // LDAP auth failed or exception raised
        if (entry === false) {
            // If LDAP is unavailable (connectivity/service error), allow local password fallback.
            // Allow local password authentication for:
            // - admin users (break-glass access)
            // - regular users when password authentication fallback is enabled
            if (user && (user.isAdmin || Boolean(ldapErrorMessage) && this.ldapConfig.options.enablePasswordAuthFallback)) {
                const localUser = await this.usersManager.logUser(user, password, ip);
                if (localUser) return localUser;
            }
            if (ldapErrorMessage) {
                throw new _common.HttpException(ldapErrorMessage, _common.HttpStatus.SERVICE_UNAVAILABLE);
            }
            return null;
        }
        if (!entry[this.ldapConfig.attributes.login] || !entry[this.ldapConfig.attributes.email]) {
            this.logger.error({
                tag: this.validateUser.name,
                msg: `required ldap fields are missing : 
      [${this.ldapConfig.attributes.login}, ${this.ldapConfig.attributes.email}] => 
      (${JSON.stringify(entry)})`
            });
            return null;
        }
        if (!user && !this.ldapConfig.options.autoCreateUser) {
            this.logger.warn({
                tag: this.validateUser.name,
                msg: `User not found and autoCreateUser is disabled`
            });
            throw new _common.HttpException('User not found', _common.HttpStatus.UNAUTHORIZED);
        }
        const identity = this.createIdentity(entry, password);
        user = await this.updateOrCreateUser(identity, user);
        this.usersManager.updateAccesses(user, ip, true).catch((e)=>this.logger.error({
                tag: this.validateUser.name,
                msg: `${e}`
            }));
        return user;
    }
    // PARTIE MODIFIEE POUR LDAPS AVEC CERTIFICAT AUTO-SIGNE
    async checkAuth(login, password) {
        // Bind and fetch LDAP entry, optionally via service account.
        const ldapLogin = this.buildLdapLogin(login);
        // AD: bind directly with the user input (UPN or DOMAIN\user)
        // Generic LDAP: build DN from login attribute + baseDN
        const bindUserDN = this.buildBindUserDN(ldapLogin);
        let error;
        for (const s of this.ldapConfig.servers){
	    const fs = require('fs');
	    const clientOptions = {
                ...this.clientOptions,
                url: s,
                tlsOptions: {
                    ca: [fs.readFileSync('/app/certs/freeipa-ca.pem')]
                }
            };
            // FIN DE LA PARTIE MOFIFIEE
            const client = new _ldapts.Client(clientOptions);
	    let attemptedBindDN = bindUserDN;
            try {
                if (this.hasServiceBind) {
                    attemptedBindDN = this.ldapConfig.serviceBindDN;
                    await client.bind(this.ldapConfig.serviceBindDN, this.ldapConfig.serviceBindPassword);
                    const result = await this.findUserEntry(ldapLogin, client);
                    if (!result || !result.userDn) {
                        this.logger.warn({
                            tag: this.checkAuth.name,
                            msg: `no LDAP entry found for : ${login}`
                        });
                        return false;
                    }
                    const { entry, userDn } = result;
                    attemptedBindDN = userDn;
                    await client.bind(userDn, password);
                    return entry;
                }
                attemptedBindDN = bindUserDN;
                await client.bind(bindUserDN, password);
                return await this.checkAccess(ldapLogin, client, bindUserDN);
            } catch (e) {
                error = this.handleBindError(e, attemptedBindDN);
                if (error instanceof _ldapts.InvalidCredentialsError) {
                    return false;
                }
            } finally{
                await client.unbind();
            }
        }
        if (error) {
            this.logger.error({
                tag: this.checkAuth.name,
                msg: `${error}`
            });
            if (_appconstants.CONNECT_ERROR_CODE.has(error.code)) {
                throw new Error('Authentication service error');
            }
        }
        return false;
    }
    async checkAccess(login, client, bindUserDN) {
        // Search for the LDAP entry and normalize attributes.
        const result = await this.findUserEntry(login, client, bindUserDN);
        return result ? result.entry : false;
    }
    async findUserEntry(login, client, bindUserDN) {
        const searchFilter = this.buildUserFilter(login, this.ldapConfig.filter);
        try {
            const { searchEntries } = await client.search(this.ldapConfig.baseDN, {
                scope: _authldapconstants.LDAP_SEARCH_ATTR.SUB,
                filter: searchFilter,
                attributes: _authldapconstants.ALL_LDAP_ATTRIBUTES
            });
            if (searchEntries.length === 0) {
                this.logger.debug({
                    tag: this.findUserEntry.name,
                    msg: `search filter : ${searchFilter}`
                });
                this.logger.warn({
                    tag: this.findUserEntry.name,
                    msg: `no LDAP entry found for : ${login}`
                });
                return false;
            }
            if (searchEntries.length > 1) {
                this.logger.warn({
                    tag: this.findUserEntry.name,
                    msg: `multiple LDAP entries found for : ${login}, using first one`
                });
            }
            const rawEntry = searchEntries[0];
            const entry = this.convertToLdapUserEntry(rawEntry);
            const userDn = rawEntry.dn || bindUserDN;
            if (this.ldapConfig.options.adminGroup && !this.hasAdminGroup(entry, this.ldapConfig.options.adminGroup)) {
                if (userDn && await this.isMemberOfGroupOfNames(this.ldapConfig.options.adminGroup, userDn, client)) {
                    const existing = Array.isArray(entry[_authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF]) ? entry[_authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF] : [];
                    entry[_authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF] = [
                        ...new Set([
                            ...existing,
                            this.ldapConfig.options.adminGroup
                        ])
                    ];
                }
            }
            // Return the first matching entry.
            return {
                entry,
                userDn
            };
        } catch (e) {
            this.logger.debug({
                tag: this.findUserEntry.name,
                msg: `search filter : ${searchFilter}`
            });
            this.logger.error({
                tag: this.findUserEntry.name,
                msg: `${login} : ${e}`
            });
            return false;
        }
    }
    async updateOrCreateUser(identity, user) {
        // Create or update the local user record from LDAP identity.
        if (user === null) {
            // Create
            identity.permissions = this.ldapConfig.options.autoCreatePermissions.join(',');
            const createdUser = await this.adminUsersManager.createUserOrGuest(identity, identity.role);
            const freshUser = await this.usersManager.fromUserId(createdUser.id);
            if (!freshUser) {
                this.logger.error({
                    tag: this.updateOrCreateUser.name,
                    msg: `user was not found : ${createdUser.login} (${createdUser.id})`
                });
                throw new _common.HttpException('User not found', _common.HttpStatus.NOT_FOUND);
            }
            return freshUser;
        }
        if (identity.login !== user.login) {
            this.logger.error({
                tag: this.updateOrCreateUser.name,
                msg: `user login mismatch : ${identity.login} !== ${user.login}`
            });
            throw new _common.HttpException('Account matching error', _common.HttpStatus.FORBIDDEN);
        }
        // Update: check if user information has changed
        const identityHasChanged = Object.fromEntries((await Promise.all(Object.keys(identity).map(async (key)=>{
            if (key === 'password') {
                const isSame = await (0, _functions.comparePassword)(identity[key], user.password);
                return isSame ? null : [
                    key,
                    identity[key]
                ];
            }
            return identity[key] !== user[key] ? [
                key,
                identity[key]
            ] : null;
        }))).filter(Boolean));
        if (Object.keys(identityHasChanged).length > 0) {
            try {
                if (identityHasChanged?.role != null) {
                    if (user.role === _user.USER_ROLE.ADMINISTRATOR && !this.ldapConfig.options.adminGroup) {
                        // Prevent removing the admin role when adminGroup was removed or not defined
                        delete identityHasChanged.role;
                    }
                }
                // Update user properties
                await this.adminUsersManager.updateUserOrGuest(user.id, identityHasChanged);
                // Extra stuff
                if (identityHasChanged?.password) {
                    delete identityHasChanged.password;
                }
                Object.assign(user, identityHasChanged);
                if ('lastName' in identityHasChanged || 'firstName' in identityHasChanged) {
                    // Force fullName update in the current user model
                    user.setFullName(true);
                }
            } catch (e) {
                this.logger.warn({
                    tag: this.updateOrCreateUser.name,
                    msg: `unable to update user *${user.login}* : ${e}`
                });
            }
        }
        return user;
    }
    convertToLdapUserEntry(entry) {
        // Normalize memberOf and other LDAP attributes for downstream usage.
        for (const attr of _authldapconstants.ALL_LDAP_ATTRIBUTES){
            if (attr === _authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF && entry[attr]) {
                const values = (Array.isArray(entry[attr]) ? entry[attr] : entry[attr] ? [
                    entry[attr]
                ] : []).filter((v)=>typeof v === 'string');
                const normalized = new Set();
                for (const value of values){
                    normalized.add(value);
                    const cn = value.match(/cn\s*=\s*([^,]+)/i)?.[1]?.trim();
                    if (cn) {
                        normalized.add(cn);
                    }
                }
                entry[attr] = Array.from(normalized);
                continue;
            }
            if (Array.isArray(entry[attr])) {
                // Keep only the first value for all other attributes (e.g., email)
                entry[attr] = entry[attr].length > 0 ? entry[attr][0] : null;
            }
        }
        return entry;
    }
    createIdentity(entry, password) {
        // Build the local identity payload from LDAP entry.
        const isAdmin = typeof this.ldapConfig.options.adminGroup === 'string' && this.ldapConfig.options.adminGroup && entry[_authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF]?.includes(this.ldapConfig.options.adminGroup);
        return {
            login: this.dbLogin(entry[this.ldapConfig.attributes.login]),
            email: entry[this.ldapConfig.attributes.email],
            password: password,
            role: isAdmin ? _user.USER_ROLE.ADMINISTRATOR : _user.USER_ROLE.USER,
            ...this.getFirstNameAndLastName(entry)
        };
    }
    getFirstNameAndLastName(entry) {
        // Resolve name fields with structured and fallback attributes.
        // 1) Prefer structured attributes
        if (entry.sn && entry.givenName) {
            return {
                firstName: entry.givenName,
                lastName: entry.sn
            };
        }
        // 2) Fallback to displayName if available
        if (entry.displayName && entry.displayName.trim()) {
            return (0, _functions.splitFullName)(entry.displayName);
        }
        // 3) Fallback to cn
        if (entry.cn && entry.cn.trim()) {
            return (0, _functions.splitFullName)(entry.cn);
        }
        // 4) Nothing usable
        return {
            firstName: '',
            lastName: ''
        };
    }
    dbLogin(login) {
        // Normalize domain-qualified logins to the user part.
        if (login.includes('\\')) {
            return login.split('\\').slice(-1)[0];
        }
        return login;
    }
    buildLdapLogin(login) {
        // Build the bind login string based on LDAP config.
        if (this.ldapConfig.attributes.login === _authldapconstants.LDAP_LOGIN_ATTR.UPN) {
            if (this.ldapConfig.upnSuffix && !login.includes('@')) {
                return `${login}@${this.ldapConfig.upnSuffix}`;
            }
        } else if (this.ldapConfig.attributes.login === _authldapconstants.LDAP_LOGIN_ATTR.SAM) {
            if (this.ldapConfig.netbiosName && !login.includes('\\')) {
                return `${this.ldapConfig.netbiosName}\\${login}`;
            }
        }
        return login;
    }
    buildBindUserDN(ldapLogin) {
        return this.isAD ? ldapLogin : `${this.ldapConfig.attributes.login}=${ldapLogin},${this.ldapConfig.baseDN}`;
    }
    buildUserFilter(login, extraFilter) {
        // Build a safe LDAP filter to search for the user entry.
        // Important: - Values passed to EqualityFilter are auto-escaped by ldapts
        //            - extraFilter is appended as-is (assumed trusted configuration)
        // Note: The OR clause differs between AD and generic LDAP.
        // Handle the case where the sAMAccountName is provided in domain-qualified format (e.g., SYNC_IN\\user)
        // Note: sAMAccountName is always stored without the domain in Active Directory.
        const dbLogin = this.dbLogin(login);
        const or = new _ldapts.OrFilter({
            filters: this.isAD ? [
                new _ldapts.EqualityFilter({
                    attribute: _authldapconstants.LDAP_LOGIN_ATTR.SAM,
                    value: dbLogin
                }),
                new _ldapts.EqualityFilter({
                    attribute: _authldapconstants.LDAP_LOGIN_ATTR.UPN,
                    value: dbLogin
                }),
                new _ldapts.EqualityFilter({
                    attribute: _authldapconstants.LDAP_LOGIN_ATTR.MAIL,
                    value: dbLogin
                })
            ] : [
                new _ldapts.EqualityFilter({
                    attribute: _authldapconstants.LDAP_LOGIN_ATTR.UID,
                    value: dbLogin
                }),
                new _ldapts.EqualityFilter({
                    attribute: _authldapconstants.LDAP_LOGIN_ATTR.CN,
                    value: dbLogin
                }),
                new _ldapts.EqualityFilter({
                    attribute: _authldapconstants.LDAP_LOGIN_ATTR.MAIL,
                    value: dbLogin
                })
            ]
        });
        // Convert to LDAP filter string
        let filterString = new _ldapts.AndFilter({
            filters: [
                or
            ]
        }).toString();
        // Optionally append an extra filter from config (trusted source)
        if (extraFilter && extraFilter.trim()) {
            filterString = `(&${filterString}${extraFilter})`;
        }
        return filterString;
    }
    hasAdminGroup(entry, adminGroup) {
        // Check for the admin group in the normalized `memberOf` list.
        return Array.isArray(entry[_authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF]) && entry[_authldapconstants.LDAP_COMMON_ATTR.MEMBER_OF].includes(adminGroup);
    }
    async isMemberOfGroupOfNames(adminGroup, userDn, client) {
        // Check groupOfNames membership by querying group entries.
        // When adminGroup is a DN, search at the group DN; otherwise search under baseDN.
        const { dn, cn } = this.parseAdminGroup(adminGroup);
        // Build a filter that matches groupOfNames entries containing the user's DN as a member.
        const filters = [
            new _ldapts.EqualityFilter({
                attribute: _authldapconstants.LDAP_SEARCH_ATTR.OBJECT_CLASS,
                value: _authldapconstants.LDAP_SEARCH_ATTR.GROUP_OF_NAMES
            }),
            new _ldapts.EqualityFilter({
                attribute: _authldapconstants.LDAP_SEARCH_ATTR.MEMBER,
                value: userDn
            })
        ];
        // If a CN is available, narrow the query to that specific group name.
        if (cn) {
            filters.splice(1, 0, new _ldapts.EqualityFilter({
                attribute: _authldapconstants.LDAP_COMMON_ATTR.CN,
                value: cn
            }));
        }
        const filter = new _ldapts.AndFilter({
            filters
        }).toString();
        try {
            // Use BASE scope for an exact DN lookup, otherwise SUB to scan within baseDN.
            const { searchEntries } = await client.search(dn || this.ldapConfig.baseDN, {
                scope: dn ? _authldapconstants.LDAP_SEARCH_ATTR.BASE : _authldapconstants.LDAP_SEARCH_ATTR.SUB,
                filter,
                attributes: [
                    _authldapconstants.LDAP_COMMON_ATTR.CN
                ]
            });
            // Any matching entry implies membership.
            return searchEntries.length > 0;
        } catch (e) {
            this.logger.warn({
                tag: this.isMemberOfGroupOfNames.name,
                msg: `${e}`
            });
            return false;
        }
    }
    parseAdminGroup(adminGroup) {
        // Accept either full DN or simple CN and extract what we can for lookups.
        const looksLikeDn = adminGroup.includes('=') && adminGroup.includes(',');
        if (!looksLikeDn) {
            return {
                cn: adminGroup
            };
        }
        const cn = adminGroup.match(/cn\s*=\s*([^,]+)/i)?.[1]?.trim();
        return {
            dn: adminGroup,
            cn
        };
    }
    handleBindError(error, attemptedBindDN) {
        // Prefer the most specific LDAP error when multiple errors are returned.
        if (error?.errors?.length) {
            for (const err of error.errors){
                this.logger.warn({
                    tag: this.handleBindError.name,
                    msg: `${attemptedBindDN} : ${err}`
                });
            }
            return error.errors[error.errors.length - 1];
        }
        this.logger.warn({
            tag: this.handleBindError.name,
            msg: `${attemptedBindDN} : ${error}`
        });
        return error;
    }
    constructor(usersManager, adminUsersManager){
        this.usersManager = usersManager;
        this.adminUsersManager = adminUsersManager;
        this.logger = new _common.Logger(AuthProviderLDAP.name);
        this.ldapConfig = _configenvironment.configuration.auth.ldap;
        this.hasServiceBind = Boolean(this.ldapConfig.serviceBindDN && this.ldapConfig.serviceBindPassword);
        this.isAD = this.ldapConfig.attributes.login === _authldapconstants.LDAP_LOGIN_ATTR.SAM || this.ldapConfig.attributes.login === _authldapconstants.LDAP_LOGIN_ATTR.UPN;
        this.clientOptions = {
            timeout: 6000,
            connectTimeout: 6000,
            url: ''
        };
    }
};
AuthProviderLDAP = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _usersmanagerservice.UsersManager === "undefined" ? Object : _usersmanagerservice.UsersManager,
        typeof _adminusersmanagerservice.AdminUsersManager === "undefined" ? Object : _adminusersmanagerservice.AdminUsersManager
    ])
], AuthProviderLDAP);

//# sourceMappingURL=auth-provider-ldap.service.js.map