/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query-v5';
import { act, renderHook, waitFor } from '@testing-library/react';
import nock from 'nock';
import React from 'react';
import { RequestHandlerContext, useInfiniteModelQuery, useModelMutation, useModelQuery } from '../src/runtime-v5/react';
import { getQueryKey } from '../src/runtime/common';
import { modelMeta } from './test-model-meta';

describe('Tanstack Query React Hooks V5 Test', () => {
    function createWrapper() {
        const queryClient = new QueryClient();
        const Provider = RequestHandlerContext.Provider;
        const wrapper = ({ children }: { children: React.ReactElement }) => (
            <QueryClientProvider client={queryClient}>
                {/* @ts-ignore */}
                <Provider value={{ logging: true }}>{children}</Provider>
            </QueryClientProvider>
        );
        return { queryClient, wrapper };
    }

    function makeUrl(model: string, operation: string, args?: unknown) {
        let r = `http://localhost/api/model/${model}/${operation}`;
        if (args) {
            r += `?q=${encodeURIComponent(JSON.stringify(args))}`;
        }
        return r;
    }

    beforeEach(() => {
        nock.cleanAll();
    });

    it('simple query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = { id: '1', name: 'foo' };

        nock(makeUrl('User', 'findUnique', queryArgs)).get(/.*/).reply(200, {
            data,
        });

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
            expect(result.current.data).toMatchObject(data);
            const cacheData = queryClient.getQueryData(getQueryKey('User', 'findUnique', queryArgs));
            expect(cacheData).toMatchObject(data);
        });
    });

    it('infinite query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = [{ id: '1', name: 'foo' }];

        nock(makeUrl('User', 'findMany', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Query findMany:', queryArgs);
                return {
                    data: data,
                };
            });

        const { result } = renderHook(
            () =>
                useInfiniteModelQuery('User', makeUrl('User', 'findMany'), queryArgs, {
                    getNextPageParam: () => null,
                }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
            const resultData = result.current.data!;
            expect(resultData.pages).toHaveLength(1);
            expect(resultData.pages[0]).toMatchObject(data);
            expect(resultData?.pageParams).toHaveLength(1);
            expect(resultData?.pageParams[0]).toMatchObject(queryArgs);
            expect(result.current.hasNextPage).toBe(false);
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', queryArgs, { infinite: true, optimisticUpdate: false })
            );
            expect(cacheData.pages[0]).toMatchObject(data);
        });
    });

    it('independent mutation and query', async () => {
        const { wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = { id: '1', name: 'foo' };

        let queryCount = 0;
        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                queryCount++;
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ name: 'foo' });
        });

        nock(makeUrl('Post', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                return { data: { id: '1', title: 'post1' } };
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('Post', 'POST', makeUrl('Post', 'create'), modelMeta),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ ...queryArgs, data: { title: 'post1' } }));

        await waitFor(() => {
            // no refetch caused by invalidation
            expect(queryCount).toBe(1);
        });
    });

    it('create and invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findMany')), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.push({ id: '1', name: 'foo' });
                return { data: data[0] };
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: { name: 'foo' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(getQueryKey('User', 'findMany', undefined));
            expect(cacheData).toHaveLength(1);
        });
    });

    it('create and no invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findMany')), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.push({ id: '1', name: 'foo' });
                return { data: data[0] };
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta, undefined, undefined, false),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: { name: 'foo' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(getQueryKey('User', 'findMany', undefined));
            expect(cacheData).toHaveLength(0);
        });
    });

    it('optimistic create single', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: { name: 'foo' } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
            expect(cacheData[0].$optimistic).toBe(true);
            expect(cacheData[0].id).toBeTruthy();
            expect(cacheData[0].name).toBe('foo');
        });
    });

    it('optimistic create updating nested query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [{ id: '1', name: 'user1', posts: [] }];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () =>
                useModelQuery(
                    'User',
                    makeUrl('User', 'findMany'),
                    { include: { posts: true } },
                    { optimisticUpdate: true }
                ),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(1);
        });

        nock(makeUrl('Post', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('Post', 'POST', makeUrl('Post', 'create'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: { title: 'post1', owner: { connect: { id: '1' } } } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey(
                    'User',
                    'findMany',
                    { include: { posts: true } },
                    { infinite: false, optimisticUpdate: true }
                )
            );
            const posts = cacheData[0].posts;
            expect(posts).toHaveLength(1);
            expect(posts[0]).toMatchObject({ $optimistic: true, id: expect.any(String), title: 'post1', ownerId: '1' });
        });
    });

    it('optimistic nested create updating query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('Post', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('Post', makeUrl('Post', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: { name: 'user1', posts: { create: { title: 'post1' } } } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('Post', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
            expect(cacheData[0].$optimistic).toBe(true);
            expect(cacheData[0].id).toBeTruthy();
            expect(cacheData[0].title).toBe('post1');
        });
    });

    it('optimistic create many', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'createMany'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'createMany'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: [{ name: 'foo' }, { name: 'bar' }] }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(2);
        });
    });

    it('update and invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = { id: '1', name: 'foo' };

        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ name: 'foo' });
        });

        nock(makeUrl('User', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.name = 'bar';
                return data;
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ ...queryArgs, data: { name: 'bar' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(getQueryKey('User', 'findUnique', queryArgs));
            expect(cacheData).toMatchObject({ name: 'bar' });
        });
    });

    it('update and no invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = { id: '1', name: 'foo' };

        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ name: 'foo' });
        });

        nock(makeUrl('User', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.name = 'bar';
                return data;
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta, undefined, undefined, false),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ ...queryArgs, data: { name: 'bar' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(getQueryKey('User', 'findUnique', queryArgs));
            expect(cacheData).toMatchObject({ name: 'foo' });
        });
    });

    it('optimistic update simple', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = { id: '1', name: 'foo' };

        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ name: 'foo' });
        });

        nock(makeUrl('User', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return data;
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ ...queryArgs, data: { name: 'bar' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(
                getQueryKey('User', 'findUnique', queryArgs, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toMatchObject({ name: 'bar', $optimistic: true });
        });
    });

    it('optimistic update updating nested query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' }, include: { posts: true } };
        const data = { id: '1', name: 'foo', posts: [{ id: 'p1', title: 'post1' }] };

        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ name: 'foo' });
        });

        nock(makeUrl('Post', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return data;
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('Post', 'PUT', makeUrl('Post', 'update'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: 'p1' },
                data: { title: 'post2', owner: { connect: { id: '2' } } },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findUnique', queryArgs, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData.posts[0]).toMatchObject({ title: 'post2', $optimistic: true, ownerId: '2' });
        });
    });

    it('optimistic nested update updating query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: 'p1' } };
        const data = { id: 'p1', title: 'post1' };

        nock(makeUrl('Post', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('Post', makeUrl('Post', 'findUnique'), queryArgs, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ title: 'post1' });
        });

        nock(makeUrl('User', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return data;
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: '1' },
                data: { posts: { update: { where: { id: 'p1' }, data: { title: 'post2' } } } },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('Post', 'findUnique', queryArgs, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toMatchObject({ title: 'post2', $optimistic: true });
        });
    });

    it('optimistic upsert - create simple', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'upsert'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'upsert'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: '1' },
                create: { id: '1', name: 'foo' },
                update: { name: 'bar' },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
            expect(cacheData[0]).toMatchObject({ id: '1', name: 'foo', $optimistic: true });
        });
    });

    it('optimistic upsert - create updating nested query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any = { id: '1', name: 'user1', posts: [{ id: 'p1', title: 'post1' }] };

        nock(makeUrl('User', 'findUnique'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () =>
                useModelQuery(
                    'User',
                    makeUrl('User', 'findUnique'),
                    { where: { id: '1' } },
                    { optimisticUpdate: true }
                ),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ id: '1' });
        });

        nock(makeUrl('Post', 'upsert'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('Post', 'POST', makeUrl('Post', 'upsert'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: 'p2' },
                create: { id: 'p2', title: 'post2', owner: { connect: { id: '1' } } },
                update: { title: 'post3' },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findUnique', { where: { id: '1' } }, { infinite: false, optimisticUpdate: true })
            );
            const posts = cacheData.posts;
            expect(posts).toHaveLength(2);
            expect(posts[0]).toMatchObject({ id: 'p2', title: 'post2', ownerId: '1', $optimistic: true });
        });
    });

    it('optimistic upsert - nested create updating query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any = [{ id: 'p1', title: 'post1' }];

        nock(makeUrl('Post', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('Post', makeUrl('Post', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(1);
        });

        nock(makeUrl('User', 'update'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: '1' },
                data: {
                    posts: {
                        upsert: {
                            where: { id: 'p2' },
                            create: { id: 'p2', title: 'post2', owner: { connect: { id: '1' } } },
                            update: { title: 'post3', owner: { connect: { id: '2' } } },
                        },
                    },
                },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('Post', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(2);
            expect(cacheData[0]).toMatchObject({ id: 'p2', title: 'post2', ownerId: '1', $optimistic: true });
        });
    });

    it('optimistic upsert - update simple', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' } };
        const data = { id: '1', name: 'foo' };

        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ name: 'foo' });
        });

        nock(makeUrl('User', 'upsert'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return data;
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'upsert'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ ...queryArgs, update: { name: 'bar' }, create: { name: 'zee' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(
                getQueryKey('User', 'findUnique', queryArgs, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toMatchObject({ name: 'bar', $optimistic: true });
        });
    });

    it('optimistic upsert - update updating nested query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any = { id: '1', name: 'user1', posts: [{ id: 'p1', title: 'post1' }] };

        nock(makeUrl('User', 'findUnique'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () =>
                useModelQuery(
                    'User',
                    makeUrl('User', 'findUnique'),
                    { where: { id: '1' } },
                    { optimisticUpdate: true }
                ),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ id: '1' });
        });

        nock(makeUrl('Post', 'upsert'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('Post', 'POST', makeUrl('Post', 'upsert'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: 'p1' },
                create: { id: 'p1', title: 'post1' },
                update: { title: 'post2' },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findUnique', { where: { id: '1' } }, { infinite: false, optimisticUpdate: true })
            );
            const posts = cacheData.posts;
            expect(posts).toHaveLength(1);
            expect(posts[0]).toMatchObject({ id: 'p1', title: 'post2', $optimistic: true });
        });
    });

    it('optimistic upsert - nested update updating query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any = [{ id: 'p1', title: 'post1' }];

        nock(makeUrl('Post', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('Post', makeUrl('Post', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(1);
        });

        nock(makeUrl('User', 'update'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({
                where: { id: '1' },
                data: {
                    posts: {
                        upsert: {
                            where: { id: 'p1' },
                            create: { id: 'p1', title: 'post1' },
                            update: { title: 'post2' },
                        },
                    },
                },
            })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('Post', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
            expect(cacheData[0]).toMatchObject({ id: 'p1', title: 'post2', $optimistic: true });
        });
    });

    it('delete and invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [{ id: '1', name: 'foo' }];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findMany')), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toHaveLength(1);
        });

        nock(makeUrl('User', 'delete'))
            .delete(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.splice(0, 1);
                return { data: [] };
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('User', 'DELETE', makeUrl('User', 'delete'), modelMeta),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ where: { id: '1' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(getQueryKey('User', 'findMany', undefined));
            expect(cacheData).toHaveLength(0);
        });
    });

    it('optimistic delete simple', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [{ id: '1', name: 'foo' }];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(1);
        });

        nock(makeUrl('User', 'delete'))
            .delete(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'DELETE', makeUrl('User', 'delete'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ where: { id: '1' } }));

        await waitFor(() => {
            const cacheData = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(0);
        });
    });

    it('optimistic delete nested query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any = { id: '1', name: 'foo', posts: [{ id: 'p1', title: 'post1' }] };

        nock(makeUrl('User', 'findFirst'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () =>
                useModelQuery(
                    'User',
                    makeUrl('User', 'findFirst'),
                    { include: { posts: true } },
                    { optimisticUpdate: true }
                ),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toMatchObject({ id: '1' });
        });

        nock(makeUrl('Post', 'delete'))
            .delete(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('Post', 'DELETE', makeUrl('Post', 'delete'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ where: { id: 'p1' } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey(
                    'User',
                    'findFirst',
                    { include: { posts: true } },
                    { infinite: false, optimisticUpdate: true }
                )
            );
            expect(cacheData.posts).toHaveLength(0);
        });
    });

    it('optimistic nested delete update query', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any = [
            { id: 'p1', title: 'post1' },
            { id: 'p2', title: 'post2' },
        ];

        nock(makeUrl('Post', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('Post', makeUrl('Post', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(2);
        });

        nock(makeUrl('User', 'update'))
            .delete(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ where: { id: '1' }, data: { posts: { delete: { id: 'p1' } } } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('Post', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
        });
    });

    it('top-level mutation and nested-read invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const queryArgs = { where: { id: '1' }, include: { posts: true } };
        const data = { posts: [{ id: '1', title: 'post1' }] };

        nock(makeUrl('User', 'findUnique', queryArgs))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('User', makeUrl('User', 'findUnique'), queryArgs), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toMatchObject(data);
        });

        nock(makeUrl('Post', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.posts[0].title = 'post2';
                return data;
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('Post', 'PUT', makeUrl('Post', 'update'), modelMeta),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ where: { id: '1' }, data: { name: 'post2' } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(getQueryKey('User', 'findUnique', queryArgs));
            expect(cacheData.posts[0].title).toBe('post2');
        });
    });

    it('nested mutation and top-level-read invalidation', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data = [{ id: '1', title: 'post1', ownerId: '1' }];

        nock(makeUrl('Post', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(() => useModelQuery('Post', makeUrl('Post', 'findMany')), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.data).toMatchObject(data);
        });

        nock(makeUrl('User', 'update'))
            .put(/.*/)
            .reply(200, () => {
                console.log('Mutating data');
                data.push({ id: '2', title: 'post2', ownerId: '1' });
                return data;
            });

        const { result: mutationResult } = renderHook(
            () => useModelMutation('User', 'PUT', makeUrl('User', 'update'), modelMeta),
            {
                wrapper,
            }
        );

        act(() =>
            mutationResult.current.mutate({ where: { id: '1' }, data: { posts: { create: { title: 'post2' } } } })
        );

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(getQueryKey('Post', 'findMany', undefined));
            expect(cacheData).toHaveLength(2);
        });
    });

    it('optimistic create with custom provider', async () => {
        const { queryClient, wrapper } = createWrapper();

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            })
            .persist();

        const { result: mutationResult1 } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                    optimisticDataProvider: ({ queryModel, queryOperation }) => {
                        if (queryModel === 'User' && queryOperation === 'findMany') {
                            return { kind: 'Skip' };
                        } else {
                            return { kind: 'ProceedDefault' };
                        }
                    },
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult1.current.mutate({ data: { name: 'foo' } }));

        // cache should not update
        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(0);
        });

        const { result: mutationResult2 } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                    optimisticDataProvider: ({ queryModel, queryOperation, currentData, mutationArgs }) => {
                        if (queryModel === 'User' && queryOperation === 'findMany') {
                            return {
                                kind: 'Update',
                                data: [
                                    ...currentData,
                                    { id: 100, name: mutationArgs.data.name + 'hooray', $optimistic: true },
                                ],
                            };
                        } else {
                            return { kind: 'ProceedDefault' };
                        }
                    },
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult2.current.mutate({ data: { name: 'foo' } }));

        // cache should update
        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
            expect(cacheData[0].$optimistic).toBe(true);
            expect(cacheData[0].id).toBeTruthy();
            expect(cacheData[0].name).toBe('foohooray');
        });
    });

    it('optimistic update mixed with non-zenstack queries', async () => {
        const { queryClient, wrapper } = createWrapper();

        // non-zenstack query
        const { result: myQueryResult } = renderHook(
            () => useQuery({ queryKey: ['myQuery'], queryFn: () => ({ data: 'myData' }) }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(myQueryResult.current.data).toEqual({ data: 'myData' });
        });

        const data: any[] = [];

        nock(makeUrl('User', 'findMany'))
            .get(/.*/)
            .reply(200, () => {
                console.log('Querying data:', JSON.stringify(data));
                return { data };
            })
            .persist();

        const { result } = renderHook(
            () => useModelQuery('User', makeUrl('User', 'findMany'), undefined, { optimisticUpdate: true }),
            {
                wrapper,
            }
        );
        await waitFor(() => {
            expect(result.current.data).toHaveLength(0);
        });

        nock(makeUrl('User', 'create'))
            .post(/.*/)
            .reply(200, () => {
                console.log('Not mutating data');
                return { data: null };
            });

        const { result: mutationResult } = renderHook(
            () =>
                useModelMutation('User', 'POST', makeUrl('User', 'create'), modelMeta, {
                    optimisticUpdate: true,
                    invalidateQueries: false,
                }),
            {
                wrapper,
            }
        );

        act(() => mutationResult.current.mutate({ data: { name: 'foo' } }));

        await waitFor(() => {
            const cacheData: any = queryClient.getQueryData(
                getQueryKey('User', 'findMany', undefined, { infinite: false, optimisticUpdate: true })
            );
            expect(cacheData).toHaveLength(1);
            expect(cacheData[0].$optimistic).toBe(true);
            expect(cacheData[0].id).toBeTruthy();
            expect(cacheData[0].name).toBe('foo');
        });
    });
});
