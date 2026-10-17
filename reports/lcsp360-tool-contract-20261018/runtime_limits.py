"""Resource caps apply only to this harness's labeled container names before start."""
LIMITS = {'postgres': ('512m', '768m', '1'), 'rabbitmq': ('768m', '1g', '1'),
          'api': ('1536m', '2g', '1'), 'server': ('2g', '2560m', '2'), 'bridge': ('1g', '1536m', '1')}

def apply(stack_module):
    original = stack_module.Stack.docker
    def docker(self, *args, **kwargs):
        if len(args) == 2 and args[0] == 'start' and args[1].startswith(self.prefix + '-'):
            role = args[1][len(self.prefix) + 1:]
            if role in LIMITS:
                memory, swap, cpus = LIMITS[role]
                original(self, 'update', '--memory=' + memory, '--memory-swap=' + swap, '--cpus=' + cpus, args[1])
        return original(self, *args, **kwargs)
    stack_module.Stack.docker = docker
